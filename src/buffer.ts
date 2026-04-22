import type { BufferSendResult } from "./types.js";

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

interface BufferGraphQLError {
	message?: string;
	extensions?: {
		code?: string;
	};
}

interface GraphQLResponse<T> {
	data?: T;
	errors?: BufferGraphQLError[];
}

interface Organization {
	id: string;
}

interface Channel {
	id: string;
	name?: string;
	service?: string;
	displayName?: string;
}

export interface BufferChannel {
	id: string;
	name: string;
	service: string;
	username?: string;
}

const BUFFER_API_URL = "https://api.buffer.com";

export function isRetryableBufferStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

function isRetryableGraphQLError(errors: BufferGraphQLError[] | undefined): boolean {
	if (!errors || errors.length === 0) return false;
	return errors.some((error) => error.extensions?.code === "RATE_LIMIT_EXCEEDED");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

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

export async function discoverChannels(args: {
	fetcher: (input: string, init?: RequestInit) => Promise<Response>;
	accessToken: string;
}): Promise<BufferChannel[]> {
	const orgQuery = `
		query GetOrganizations {
			account {
				organizations {
					id
				}
			}
		}
	`;

	const organizationsResult = await fetchGraphQL<{ account?: { organizations?: Organization[] } }>({
		fetcher: args.fetcher,
		accessToken: args.accessToken,
		query: orgQuery,
	});

	if (!organizationsResult.ok) {
		throw new Error(
			`Buffer organizations query failed${
				typeof organizationsResult.status === "number" ? ` (${organizationsResult.status})` : ""
			}: ${organizationsResult.error}`,
		);
	}

	const organizations = organizationsResult.data.account?.organizations ?? [];
	if (organizations.length === 0) return [];

	const channelQuery = `
		query GetChannels($organizationId: ID!) {
			channels(input: { organizationId: $organizationId }) {
				id
				name
				displayName
				service
			}
		}
	`;

	const channels = new Map<string, BufferChannel>();
	const channelErrors: string[] = [];
	for (const organization of organizations) {
		if (!organization.id) continue;

		const channelsResult = await fetchGraphQL<{ channels?: Channel[] }>({
			fetcher: args.fetcher,
			accessToken: args.accessToken,
			query: channelQuery,
			variables: { organizationId: organization.id },
		});

		if (!channelsResult.ok) {
			channelErrors.push(
				`org ${organization.id}${
					typeof channelsResult.status === "number" ? ` (${channelsResult.status})` : ""
				}: ${channelsResult.error}`,
			);
			continue;
		}
		for (const channel of channelsResult.data.channels ?? []) {
			if (!channel.id) continue;
			channels.set(channel.id, {
				id: channel.id,
				name: channel.name ?? channel.displayName ?? channel.id,
				service: channel.service ?? "unknown",
				username: channel.displayName,
			});
		}
	}

	if (channels.size === 0 && channelErrors.length > 0) {
		throw new Error(`Buffer channels query failed: ${channelErrors[0]}`);
	}

	return [...channels.values()];
}

export async function discoverChannelIds(args: {
	fetcher: (input: string, init?: RequestInit) => Promise<Response>;
	accessToken: string;
}): Promise<string[]> {
	const channels = await discoverChannels(args);
	return channels.map((channel) => channel.id);
}

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
			if ("message" in createPost && createPost.message) {
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
