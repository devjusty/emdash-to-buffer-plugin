import type { BufferSendResult } from "./types.js";

// This file implements the core logic for sending updates to Buffer, including GraphQL queries and mutations, error handling, and retry logic with exponential backoff.
interface SendBufferUpdateArgs {
	fetcher: (input: string, init?: RequestInit) => Promise<Response>;
	accessToken: string;
	channelId: string;
	text: string;
	mediaUrl?: string;
	maxAttempts?: number;
	baseDelayMs?: number;
	log: { warn: (message: string, meta?: unknown) => void };
}

// Internal interfaces for GraphQL responses and errors
interface BufferGraphQLError {
	message?: string;
	extensions?: {
		code?: string;
	};
}

// This interface represents the structure of a GraphQL response, which may contain data or errors.
interface GraphQLResponse<T> {
	data?: T;
	errors?: BufferGraphQLError[];
}

// These interfaces represent the relevant parts of the Buffer API for organizations and channels, used in the channel discovery process.
interface Organization {
	id: string;
}

// This interface represents a Buffer channel, which is a destination for scheduled posts.
interface Channel {
	id: string;
}

const BUFFER_API_URL = "https://api.buffer.com";

// This function determines if a given HTTP status code from the Buffer API indicates a retryable error, such as rate limiting or server errors.
export function isRetryableBufferStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

// This function checks if any of the GraphQL errors returned by the Buffer API are retryable, specifically looking for rate limit exceeded errors.
function isRetryableGraphQLError(errors: BufferGraphQLError[] | undefined): boolean {
	if (!errors || errors.length === 0) return false;
	return errors.some((error) => error.extensions?.code === "RATE_LIMIT_EXCEEDED");
}

// This utility function creates a promise that resolves after a specified number of milliseconds, used for implementing delays between retry attempts.
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

// This function performs a GraphQL request to the Buffer API, handling authentication, parsing the response, and determining if errors are retryable based on HTTP status codes and GraphQL error codes.
async function fetchGraphQL<T>(args: {
	fetcher: (input: string, init?: RequestInit) => Promise<Response>;
	accessToken: string;
	query: string;
	variables?: Record<string, unknown>;
}): Promise<{ ok: true; data: T } | { ok: false; status?: number; error: string; retryable: boolean }> {
	try {
		const response = await args.fetcher(BUFFER_API_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${args.accessToken}`,
			},
			body: JSON.stringify({
				query: args.query,
				variables: args.variables ?? {},
			}),
		});

		if (!response.ok) {
			return {
				ok: false,
				status: response.status,
				error: await response.text(),
				retryable: isRetryableBufferStatus(response.status),
			};
		}

		const body = (await response.json()) as GraphQLResponse<T>;
		if (body.errors && body.errors.length > 0) {
			const message = body.errors.map((error) => error.message ?? "Unknown GraphQL error").join("; ");
			return {
				ok: false,
				status: response.status,
				error: message,
				retryable: isRetryableGraphQLError(body.errors),
			};
		}

		if (!body.data) {
			return { ok: false, status: response.status, error: "Missing GraphQL data", retryable: false };
		}

		return { ok: true, data: body.data };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
			retryable: true,
		};
	}
}

// This function discovers all Buffer channel IDs accessible to the user by first querying for organizations and then for channels within those organizations, returning a list of unique channel IDs.
export async function discoverChannelIds(args: {
	fetcher: (input: string, init?: RequestInit) => Promise<Response>;
	accessToken: string;
}): Promise<string[]> {
	const orgQuery = `
		query GetOrganizations {
			account {
				organizations {
					id
				}
			}
		}
	`;

  // First, we fetch the list of organizations the user has access to. If this fails or returns no organizations, we return an empty list.
	const organizationsResult = await fetchGraphQL<{ account?: { organizations?: Organization[] } }>({
		fetcher: args.fetcher,
		accessToken: args.accessToken,
		query: orgQuery,
	});

	if (!organizationsResult.ok) return [];

	const organizations = organizationsResult.data.account?.organizations ?? [];
	if (organizations.length === 0) return [];

	const channelQuery = `
		query GetChannels($organizationId: String!) {
			channels(input: { organizationId: $organizationId }) {
				id
			}
		}
	`;

	const channelIds = new Set<string>();
	for (const organization of organizations) {
		if (!organization.id) continue;

		const channelsResult = await fetchGraphQL<{ channels?: Channel[] }>({
			fetcher: args.fetcher,
			accessToken: args.accessToken,
			query: channelQuery,
			variables: { organizationId: organization.id },
		});

		if (!channelsResult.ok) continue;
		for (const channel of channelsResult.data.channels ?? []) {
			if (channel.id) channelIds.add(channel.id);
		}
	}

	return [...channelIds];
}

// This function attempts to send a post to Buffer using the provided text, media URL, and channel ID. It implements retry logic with exponential backoff for handling transient errors such as rate limits or server issues, and returns a result indicating success or failure along with any relevant status or error information.
export async function sendBufferUpdate(args: SendBufferUpdateArgs): Promise<BufferSendResult> {
	const maxAttempts = args.maxAttempts ?? 3;
	const baseDelayMs = args.baseDelayMs ?? 500;
	const mutation = `
		mutation CreatePost($input: CreatePostInput!) {
			createPost(input: $input) {
				... on PostActionSuccess {
					post {
						id
						status
					}
				}
				... on MutationError {
					message
				}
			}
		}
	`;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const result = await fetchGraphQL<{
			createPost?:
				| { post?: { id?: string; status?: string }; message?: never }
				| { message?: string; post?: never };
		}>({
			fetcher: args.fetcher,
			accessToken: args.accessToken,
			query: mutation,
			variables: {
				input: {
					text: args.text,
					channelId: args.channelId,
					schedulingType: "automatic",
					mode: "addToQueue",
					...(args.mediaUrl ? { assets: { images: [{ url: args.mediaUrl }] } } : {}),
				},
			},
		});

		if (result.ok) {
			const createPost = result.data.createPost;
			if (!createPost) {
				return { ok: false, status: 200, error: "Missing createPost response" };
			}
			if (createPost && "message" in createPost && createPost.message) {
				return { ok: false, error: createPost.message };
			}

			return { ok: true, status: 200 };
		}

		if (!result.retryable || attempt === maxAttempts) {
			return { ok: false, status: result.status, error: result.error };
		}

		const jitter = Math.floor(Math.random() * 100);
		const delay = baseDelayMs * 2 ** (attempt - 1) + jitter;
		args.log.warn("Retrying Buffer update", {
			attempt,
			status: result.status,
			channelId: args.channelId,
		});
		await sleep(delay);
	}

	return { ok: false, error: "unreachable" };
}
