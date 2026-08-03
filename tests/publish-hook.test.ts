import { describe, expect, it, vi } from "vitest";

import { handleAfterPublish, handleAfterSave, pluginDefinition } from "../src/runtime.js";

function createContext(
	overrides?: Record<string, unknown>,
	fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
	storageOverrides?: {
		put?: (id: string, value: unknown) => Promise<void>;
		query?: (input: unknown) => Promise<{
			items: Array<{ id: string }>;
			cursor?: string;
			hasMore?: boolean;
		}>;
		deleteMany?: (ids: string[]) => Promise<void>;
	},
) {
	const kvData = new Map<string, unknown>([
		["settings:enabled", true],
		["settings:accessToken", "token-123"],
		["settings:enabledChannelIds", ["p1", "p2"]],
		["settings:messageTemplate", "{title}{excerpt}{url}"],
		["settings:siteUrl", "https://example.com"],
		[
			"state:discoveredChannels",
			[
				{ id: "p1", name: "LinkedIn", service: "linkedin", displayName: "linkedin" },
				{ id: "p2", name: "LinkedIn 2", service: "linkedin", displayName: "linkedin" },
			],
		],
	]);

	if (overrides) {
		for (const [key, value] of Object.entries(overrides)) {
			kvData.set(key, value);
		}
	}

	const fetchMock = vi.fn(
		fetchImpl ??
			(async (_input: string, init?: RequestInit) => {
				JSON.parse(String(init?.body));
				return new Response(JSON.stringify({ data: { createPost: { post: { id: "p" } } } }), {
					status: 200,
				});
			}),
	);
	const putMock = vi.fn(storageOverrides?.put ?? (async () => {}));
	const queryMock = vi.fn(
		storageOverrides?.query ?? (async () => ({ items: [], hasMore: false })),
	);
	const deleteManyMock = vi.fn(storageOverrides?.deleteMany ?? (async () => {}));

	return {
		ctx: {
			kv: {
				get: async (key: string) => (kvData.has(key) ? kvData.get(key) : null),
				set: async (key: string, value: unknown) => {
					kvData.set(key, value);
				},
			},
			site: { url: "https://example.com" },
			http: {
				fetch: fetchMock,
			},
			storage: {
				delivery_logs: {
					put: putMock,
					query: queryMock,
					deleteMany: deleteManyMock,
				},
			},
			log: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			},
		} as any,
		fetchMock,
		putMock,
		queryMock,
		deleteManyMock,
		kvData,
	};
}

const publishedPost = {
	id: "post-1",
	slug: "hello-world",
	data: {
		title: "Hello World",
		excerpt: "Excerpt",
	},
	status: "published",
	published_at: "2026-04-21T00:00:00.000Z",
};

describe("content:afterPublish hook", () => {
	it("sends to all enabled channels when a post is published", async () => {
		const { ctx, fetchMock } = createContext();

		await handleAfterPublish(
			{
				collection: "posts",
				content: publishedPost,
			},
			ctx,
		);

		expect(ctx.log.info).toHaveBeenCalledWith(
			"emdash-to-buffer publish attempt",
			expect.objectContaining({
				hook: "content:afterPublish",
				collection: "posts",
				contentId: "post-1",
				contentStatus: "published",
				isNew: false,
			}),
		);
		expect(ctx.log.info).toHaveBeenCalledWith(
			"emdash-to-buffer image extraction",
			expect.objectContaining({
				pickedImageUrl: null,
				contentKeys: expect.arrayContaining(["id", "slug", "data", "status", "published_at"]),
				dataKeys: expect.arrayContaining(["title", "excerpt"]),
			}),
		);
		const firstRequestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
			variables?: { input?: { text?: string } };
		};
		expect(firstRequestBody.variables?.input?.text).toContain("Hello World");
		expect(firstRequestBody.variables?.input?.text).toContain("Excerpt");
		expect(firstRequestBody.variables?.input?.text).toContain(
			"https://example.com/posts/hello-world",
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(ctx.kv.get).toBeDefined();
	});

	it("skips when post was already delivered (no republish after unpublish)", async () => {
		const { ctx, fetchMock } = createContext({
			"state:delivered:post-1": { at: "2026-04-20T00:00:00.000Z", hook: "content:afterPublish" },
		});

		await handleAfterPublish(
			{
				collection: "posts",
				content: publishedPost,
			},
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(0);
		expect(ctx.log.info).toHaveBeenCalledWith(
			"emdash-to-buffer skipped send; already delivered",
			expect.objectContaining({ postId: "post-1" }),
		);
	});

	it("claims delivery so a second hook cannot double-queue", async () => {
		const { ctx, fetchMock, kvData } = createContext();

		await handleAfterPublish(
			{ collection: "posts", content: publishedPost },
			ctx,
		);
		await handleAfterPublish(
			{ collection: "posts", content: publishedPost },
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(kvData.get("state:delivered:post-1")).toEqual(
			expect.objectContaining({ hook: "content:afterPublish" }),
		);
	});

	it("skips publishing when explicit enabled channels list is empty", async () => {
		const { ctx, fetchMock, putMock } = createContext({ "settings:enabledChannelIds": [] });

		await handleAfterPublish(
			{ collection: "posts", content: publishedPost },
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(0);
		expect(putMock).toHaveBeenCalledTimes(1);
		expect(putMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				status: "failed",
				channelId: "-",
				message: "No enabled Buffer channels found",
			}),
		);
	});

	it("falls back to /posts/{slug} when no canonical URL is present", async () => {
		const { ctx, fetchMock } = createContext();

		await handleAfterPublish(
			{
				collection: "posts",
				content: {
					id: "post-3",
					slug: "hello-world",
					data: { title: "Hello World", excerpt: "Excerpt" },
					status: "published",
				},
			},
			ctx,
		);

		const firstRequestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
			variables?: { input?: { text?: string } };
		};
		expect(firstRequestBody.variables?.input?.text).toContain(
			"https://example.com/posts/hello-world",
		);
	});

	it("uses content canonical URL when present", async () => {
		const { ctx, fetchMock } = createContext();

		await handleAfterPublish(
			{
				collection: "posts",
				content: {
					id: "post-4",
					slug: "hello-world",
					seo: { canonical: "/custom/hello-world" },
					data: { title: "Hello World", excerpt: "Excerpt" },
					status: "published",
				},
			},
			ctx,
		);

		const firstRequestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
			variables?: { input?: { text?: string } };
		};
		expect(firstRequestBody.variables?.input?.text).toContain(
			"https://example.com/custom/hello-world",
		);
	});

	it("omits image assets for localhost image URLs", async () => {
		const { ctx, fetchMock } = createContext();
		ctx.site.url = "http://localhost:4321";

		await handleAfterPublish(
			{
				collection: "posts",
				content: {
					id: "post-5",
					slug: "hello-local",
					featured_image: "/_emdash/api/media/file/01LOCAL.jpg",
					data: { title: "Hello Local", excerpt: "Excerpt" },
					status: "published",
				},
			},
			ctx,
		);

		const firstRequestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
			variables?: { input?: { assets?: { images?: Array<{ url?: string }> } } };
		};
		expect(firstRequestBody.variables?.input?.assets).toBeUndefined();
	});

	it("uses Buffer's new single-image asset input shape", async () => {
		const { ctx, fetchMock } = createContext();

		await handleAfterPublish(
			{
				collection: "posts",
				content: {
					id: "post-6",
					slug: "hello-image",
					featured_image: "https://cdn.example.com/featured.jpg",
					data: { title: "Hello Image", excerpt: "Excerpt" },
					status: "published",
				},
			},
			ctx,
		);

		const firstRequestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
			variables?: {
				input?: { assets?: { image?: { url?: string }; images?: Array<{ url?: string }> } };
			};
		};
		expect(firstRequestBody.variables?.input?.assets).toEqual({
			image: { url: "https://cdn.example.com/featured.jpg" },
		});
		expect(firstRequestBody.variables?.input?.assets?.images).toBeUndefined();
	});

	it("skips non-post collections", async () => {
		const { ctx, fetchMock } = createContext();

		await handleAfterPublish(
			{
				collection: "pages",
				content: {
					id: "page-1",
					slug: "about",
					data: { title: "About" },
					status: "published",
				},
			},
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(0);
	});

	it("auto-discovers channels when no channel IDs are configured", async () => {
		const fetchImpl = async (_input: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as {
				query?: string;
				variables?: Record<string, string>;
			};

			if (body.query?.includes("GetOrganizations")) {
				return new Response(
					JSON.stringify({
						data: {
							account: {
								organizations: [{ id: "org-1" }],
							},
						},
					}),
					{ status: 200 },
				);
			}

			if (body.query?.includes("GetChannels") && body.variables?.organizationId === "org-1") {
				return new Response(
					JSON.stringify({
						data: {
							channels: [{ id: "chan-1" }, { id: "chan-2" }],
						},
					}),
					{ status: 200 },
				);
			}

			return new Response(
				JSON.stringify({ data: { createPost: { post: { id: "post-created" } } } }),
				{ status: 200 },
			);
		};

		const { ctx, fetchMock, kvData } = createContext(
			{ "settings:enabledChannelIds": null },
			fetchImpl,
		);
		kvData.set("state:discoveredChannels", []);

		await handleAfterPublish(
			{ collection: "posts", content: publishedPost },
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("sends channel-specific metadata for facebook and google business channels", async () => {
		const { ctx, fetchMock, kvData } = createContext({ "settings:enabledChannelIds": null });
		kvData.set("state:discoveredChannels", [
			{ id: "fb-1", name: "Facebook", service: "facebook" },
			{ id: "gb-1", name: "Google Business", service: "googlebusiness" },
		]);

		await handleAfterPublish(
			{
				collection: "posts",
				content: {
					id: "post-9",
					slug: "social-post",
					data: {
						title: "Social Post",
						excerpt: "Snippet",
					},
					status: "published",
				},
			},
			ctx,
		);

		const facebookBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
			variables?: { input?: { metadata?: { facebook?: { type?: string } } } };
		};
		const googleBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
			variables?: { input?: { metadata?: { google?: { type?: string } } } };
		};

		expect(facebookBody.variables?.input?.metadata?.facebook?.type).toBe("post");
		expect(googleBody.variables?.input?.metadata?.google?.type).toBe("whats_new");
	});

	it("writes delivery log rows for successful and failed publish attempts", async () => {
		const fetchImpl = async (_input: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as {
				variables?: { input?: { channelId?: string } };
			};
			if (body.variables?.input?.channelId === "p2") {
				return new Response("bad request", { status: 400 });
			}
			return new Response(
				JSON.stringify({ data: { createPost: { post: { id: "post-created" } } } }),
				{ status: 200 },
			);
		};

		const { ctx, putMock } = createContext(undefined, fetchImpl);

		await handleAfterPublish(
			{ collection: "posts", content: publishedPost },
			ctx,
		);

		expect(putMock).toHaveBeenCalledTimes(2);
		expect(putMock).toHaveBeenNthCalledWith(
			1,
			expect.any(String),
			expect.objectContaining({
				status: "success",
				channelId: "p1",
				postId: "post-1",
				postSlug: "hello-world",
				message: "Queued in Buffer",
				code: "200",
			}),
		);
		expect(putMock).toHaveBeenNthCalledWith(
			2,
			expect.any(String),
			expect.objectContaining({
				status: "failed",
				channelId: "p2",
				postId: "post-1",
				postSlug: "hello-world",
				message: "bad request",
				code: "400",
			}),
		);
	});

	it("prunes oldest delivery logs to 200 entries after appending", async () => {
		const { ctx, queryMock, deleteManyMock } = createContext(
			{ "settings:enabledChannelIds": ["p1"] },
			undefined,
			{
				query: async () => ({
					items: Array.from({ length: 205 }, (_value, index) => ({ id: `old-${index + 1}` })),
				}),
			},
		);

		await handleAfterPublish(
			{ collection: "posts", content: publishedPost },
			ctx,
		);

		expect(queryMock).toHaveBeenCalledWith(
			expect.objectContaining({ orderBy: { createdAt: "asc" }, limit: 500 }),
		);
		expect(deleteManyMock).toHaveBeenCalledWith([
			"old-1",
			"old-2",
			"old-3",
			"old-4",
			"old-5",
		]);
	});

	it("prunes logs globally to 200 when storage has more than 500 rows", async () => {
		type StorageRow = { id: string; createdAt: string };
		const rows: StorageRow[] = Array.from({ length: 801 }, (_value, index) => ({
			id: `old-${index + 1}`,
			createdAt: `2026-04-20T00:00:${String(index).padStart(2, "0")}.000Z`,
		}));

		const { ctx, deleteManyMock, queryMock } = createContext(
			{ "settings:enabledChannelIds": ["p1"] },
			undefined,
			{
				query: async (input) => {
					const request = input as { cursor?: string; limit?: number };
					const pageSize = request.limit ?? 500;
					const startIndex = request.cursor ? Number(request.cursor) : 0;
					const page = rows.slice(startIndex, startIndex + pageSize);
					const nextIndex = startIndex + page.length;
					const hasMore = nextIndex < rows.length;
					return {
						items: page.map((row) => ({ id: row.id })),
						cursor: hasMore ? String(nextIndex) : undefined,
						hasMore,
					};
				},
				put: async (id, value) => {
					const record = value as { createdAt?: string };
					rows.push({ id, createdAt: record.createdAt ?? new Date().toISOString() });
				},
				deleteMany: async (ids) => {
					const remove = new Set(ids);
					for (let index = rows.length - 1; index >= 0; index -= 1) {
						const row = rows[index];
						if (row && remove.has(row.id)) rows.splice(index, 1);
					}
				},
			},
		);

		await handleAfterPublish(
			{ collection: "posts", content: publishedPost },
			ctx,
		);

		const totalDeleted = deleteManyMock.mock.calls.reduce(
			(total, call) => total + ((call[0] as string[] | undefined)?.length ?? 0),
			0,
		);
		expect(queryMock).toHaveBeenCalledTimes(2);
		expect(queryMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ orderBy: { createdAt: "asc" }, limit: 500 }),
		);
		expect(queryMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				orderBy: { createdAt: "asc" },
				limit: 500,
				cursor: "500",
			}),
		);
		expect(deleteManyMock).toHaveBeenCalled();
		expect(totalDeleted).toBe(602);
		expect(rows).toHaveLength(200);
		expect(rows.some((row) => row.id === "old-1")).toBe(false);
	});
});

describe("content:afterSave hook", () => {
	it("sends for create-as-published (isNew + published)", async () => {
		const { ctx, fetchMock } = createContext();

		await handleAfterSave(
			{
				collection: "posts",
				isNew: true,
				content: {
					id: "post-1",
					slug: "hello-world",
					data: {
						title: "Hello World",
						excerpt: "Excerpt",
					},
					status: "published",
				},
			},
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(ctx.log.info).toHaveBeenCalledWith(
			"emdash-to-buffer publish attempt",
			expect.objectContaining({
				hook: "content:afterSave",
				isNew: true,
			}),
		);
	});

	it("skips published updates that are not new creates", async () => {
		const { ctx, fetchMock } = createContext();

		await handleAfterSave(
			{
				collection: "posts",
				isNew: false,
				content: publishedPost,
			},
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(0);
	});

	it("skips published saves without isNew", async () => {
		const { ctx, fetchMock } = createContext();

		await handleAfterSave(
			{
				collection: "posts",
				content: publishedPost,
			} as any,
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(0);
	});
});

describe("admin settings", () => {
	it("keeps explicit empty enabledChannelIds through settings load and save", async () => {
		const discoveredChannels = [
			{ id: "c1", name: "Channel 1", service: "twitter" },
			{ id: "c2", name: "Channel 2", service: "linkedin" },
		];
		const { ctx } = createContext({
			"settings:enabledChannelIds": [],
			"state:discoveredChannels": discoveredChannels,
		});

		const firstLoad = (await pluginDefinition.routes.admin.handler(
			{ input: { type: "page_load", page: "/settings" } },
			ctx,
		)) as {
			blocks: Array<{
				type?: string;
				block_id?: string;
				fields?: Array<{ action_id?: string; initial_value?: unknown }>;
			}>;
		};

		const formBlock = firstLoad.blocks.find(
			(block) => block.type === "form" && block.block_id === "buffer-settings",
		);
		const enabledField = formBlock?.fields?.find(
			(field) => field.action_id === "enabledChannelIds",
		);
		expect(enabledField?.initial_value).toEqual([]);

		await pluginDefinition.routes.admin.handler(
			{
				input: {
					type: "form_submit",
					action_id: "save_settings",
					values: {
						enabledChannelIds: [],
						messageTemplate: "{title} {url}",
						enabled: true,
					},
				},
			},
			ctx,
		);

		const secondLoad = (await pluginDefinition.routes.admin.handler(
			{ input: { type: "page_load", page: "/settings" } },
			ctx,
		)) as {
			blocks: Array<{
				type?: string;
				block_id?: string;
				fields?: Array<{ action_id?: string; initial_value?: unknown }>;
			}>;
		};

		const formBlockAfterSave = secondLoad.blocks.find(
			(block) => block.type === "form" && block.block_id === "buffer-settings",
		);
		const enabledFieldAfterSave = formBlockAfterSave?.fields?.find(
			(field) => field.action_id === "enabledChannelIds",
		);
		expect(enabledFieldAfterSave?.initial_value).toEqual([]);
	});
});
