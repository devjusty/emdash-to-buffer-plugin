import { describe, expect, it, vi } from "vitest";

import { handleAfterSave } from "../src/runtime.js";

function createContext(overrides?: Record<string, unknown>) {
	const kvData = new Map<string, unknown>([
		["settings:enabled", true],
		["settings:accessToken", "token-123"],
		["settings:profileIds", "p1,p2"],
		["settings:messageTemplate", "{title} {url}"],
		["settings:siteUrl", "https://example.com"],
	]);

	if (overrides) {
		for (const [key, value] of Object.entries(overrides)) {
			kvData.set(key, value);
		}
	}

	const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

	return {
		ctx: {
			kv: {
				get: async (key: string) => (kvData.has(key) ? kvData.get(key) : null),
				set: async (key: string, value: unknown) => {
					kvData.set(key, value);
				},
			},
			http: {
				fetch: fetchMock,
			},
			log: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			},
		} as any,
		fetchMock,
	};
}

describe("content:afterSave hook", () => {
	it("sends to all profiles for first publish in posts collection", async () => {
		const { ctx, fetchMock } = createContext();

		await handleAfterSave(
			{
				collection: "posts",
				before: { status: "draft", published_at: null },
				content: {
					id: "post-1",
					slug: "hello-world",
					title: "Hello World",
					excerpt: "Excerpt",
					status: "published",
					published_at: "2026-04-21T00:00:00.000Z",
				},
			},
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("skips non-post collections", async () => {
		const { ctx, fetchMock } = createContext();

		await handleAfterSave(
			{
				collection: "pages",
				before: { status: "draft", published_at: null },
				content: {
					id: "page-1",
					slug: "about",
					title: "About",
					status: "published",
					published_at: "2026-04-21T00:00:00.000Z",
				},
			},
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(0);
	});

	it("skips updates after initial publish", async () => {
		const { ctx, fetchMock } = createContext();

		await handleAfterSave(
			{
				collection: "posts",
				before: { status: "published", published_at: "2026-04-21T00:00:00.000Z" },
				content: {
					id: "post-1",
					slug: "hello-world",
					title: "Hello World updated",
					status: "published",
					published_at: "2026-04-21T00:00:00.000Z",
				},
			},
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(0);
	});
});
