import type { BufferSendResult } from "./types.js";

interface SendBufferUpdateArgs {
	fetcher: (input: string, init?: RequestInit) => Promise<Response>;
	accessToken: string;
	profileId: string;
	text: string;
	mediaUrl?: string;
	maxAttempts?: number;
	baseDelayMs?: number;
	log: { warn: (message: string, meta?: unknown) => void };
}

export function isRetryableBufferStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export async function sendBufferUpdate(args: SendBufferUpdateArgs): Promise<BufferSendResult> {
	const maxAttempts = args.maxAttempts ?? 3;
	const baseDelayMs = args.baseDelayMs ?? 500;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			const response = await args.fetcher("https://api.bufferapp.com/1/updates/create.json", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${args.accessToken}`,
				},
				body: JSON.stringify({
					profile_ids: [args.profileId],
					text: args.text,
					...(args.mediaUrl ? { media: { link: args.mediaUrl } } : {}),
				}),
			});

			if (response.ok) {
				return { ok: true, status: response.status };
			}

			if (!isRetryableBufferStatus(response.status) || attempt === maxAttempts) {
				return { ok: false, status: response.status, error: await response.text() };
			}

			const jitter = Math.floor(Math.random() * 100);
			const delay = baseDelayMs * 2 ** (attempt - 1) + jitter;
			args.log.warn("Retrying Buffer update", {
				attempt,
				status: response.status,
				profileId: args.profileId,
			});
			await sleep(delay);
		} catch (error) {
			if (attempt === maxAttempts) {
				return {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}

			const jitter = Math.floor(Math.random() * 100);
			await sleep(baseDelayMs * 2 ** (attempt - 1) + jitter);
		}
	}

	return { ok: false, error: "unreachable" };
}
