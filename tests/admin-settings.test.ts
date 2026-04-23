import { describe, expect, it, vi } from "vitest";

import { pluginDefinition } from "../src/runtime.js";

function createContext(initial: Array<[string, unknown]> = []) {
	const kvData = new Map<string, unknown>(initial);
	const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)) as { query?: string; variables?: Record<string, string> };

		if (body.query?.includes("GetOrganizations")) {
			return new Response(
				JSON.stringify({ data: { account: { organizations: [{ id: "org-1" }] } } }),
				{ status: 200 },
			);
		}

		if (body.query?.includes("GetChannels") && body.variables?.organizationId === "org-1") {
			return new Response(
				JSON.stringify({
					data: {
						channels: [
							{ id: "chan-1", name: "Main X", service: "twitter", displayName: "main" },
							{ id: "chan-2", name: "LinkedIn", service: "linkedin" },
						],
					},
				}),
				{ status: 200 },
			);
		}

		return new Response(JSON.stringify({ data: {} }), { status: 200 });
	});

	return {
		ctx: {
			kv: {
				get: async (key: string) => (kvData.has(key) ? kvData.get(key) : null),
				set: async (key: string, value: unknown) => {
					kvData.set(key, value);
				},
			},
			http: { fetch: fetchMock },
			log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		} as any,
		kvData,
		fetchMock,
	};
}

describe("admin settings route", () => {
	it("loads settings page with discovered channel table and toggles", async () => {
		const { ctx } = createContext([
			["settings:accessToken", "token"],
			["settings:enabled", true],
		]);

		const response = await pluginDefinition.routes.admin.handler(
			{ input: { type: "page_load", page: "/settings" } },
			ctx,
		);

		const table = response.blocks.find((block: any) => block.type === "table") as any;
		expect(table.rows).toHaveLength(2);
		expect(table.rows[0].id).toBe("chan-1");

		const form = response.blocks.find((block: any) => block.type === "form") as any;
		const enabledField = form.fields.find((field: any) => field.action_id === "enabledChannelIds") as any;
		expect(enabledField.initial_value).toEqual(["chan-1", "chan-2"]);
	});

	it("saves enabled channels from settings form", async () => {
		const { ctx, kvData } = createContext([
			["settings:accessToken", "token"],
			["settings:enabled", true],
		]);

		await pluginDefinition.routes.admin.handler(
			{
				input: {
					type: "form_submit",
					action_id: "save_settings",
					values: {
						enabledChannelIds: ["chan-2"],
						messageTemplate: "{title} {url}",
						enabled: true,
					},
				},
			},
			ctx,
		);

		expect(kvData.get("settings:enabledChannelIds")).toEqual(["chan-2"]);
	});

	it("renders delivery log table rows newest-first", async () => {
		const { ctx } = createContext([
			["settings:accessToken", "token"],
			["settings:enabled", true],
		]);

		ctx.storage = {
			delivery_logs: {
				query: vi.fn(async () => ({
					items: [
						{
							id: "log-1",
							data: {
								createdAt: "2026-01-01T00:00:00.000Z",
								postId: "post-1",
								postSlug: "older-post",
								channelId: "chan-1",
								status: "success",
								code: "200",
								message: "Older",
							},
						},
						{
							id: "log-2",
							data: {
								createdAt: "2026-02-01T00:00:00.000Z",
								postId: "post-2",
								postSlug: "newer-post",
								channelId: "chan-2",
								status: "failed",
								code: "429",
								message: "Newer",
							},
						},
					],
				})),
			},
		} as any;

		const response = await pluginDefinition.routes.admin.handler(
			{ input: { type: "page_load", page: "/settings" } },
			ctx,
		);

		const table = response.blocks.find((block: any) => block.block_id === "delivery-log-table") as any;
		expect(table).toBeTruthy();
		expect(table.rows).toHaveLength(2);
		expect(table.rows[0].post).toBe("newer-post");
		expect(table.rows[1].post).toBe("older-post");
	});

	it("clears delivery logs from block action and shows success toast", async () => {
		const { ctx } = createContext([
			["settings:accessToken", "token"],
			["settings:enabled", true],
		]);

		const deleteMany = vi.fn(async () => {});
		ctx.storage = {
			delivery_logs: {
				query: vi.fn(async () => ({
					items: [
						{ id: "log-1", data: { createdAt: "2026-02-01T00:00:00.000Z" } },
						{ id: "log-2", data: { createdAt: "2026-01-01T00:00:00.000Z" } },
					],
					hasMore: false,
				})),
				deleteMany,
			},
		} as any;

		const response = await pluginDefinition.routes.admin.handler(
			{ input: { type: "block_action", action_id: "clear_delivery_logs" } },
			ctx,
		) as any;

		expect(deleteMany).toHaveBeenCalledWith(["log-1", "log-2"]);
		expect(response.toast.type).toBe("success");
		expect(response.toast.message).toContain("Cleared");
	});

	it("clears delivery logs across multiple pages", async () => {
		const { ctx } = createContext([
			["settings:accessToken", "token"],
			["settings:enabled", true],
		]);

		const deleteMany = vi.fn(async () => {});
		const query = vi
			.fn()
			.mockResolvedValueOnce({
				items: [
					{ id: "log-1", data: { createdAt: "2026-02-01T00:00:00.000Z" } },
					{ id: "log-2", data: { createdAt: "2026-02-02T00:00:00.000Z" } },
				],
				hasMore: true,
				cursor: "2",
			})
			.mockResolvedValueOnce({
				items: [
					{ id: "log-3", data: { createdAt: "2026-02-03T00:00:00.000Z" } },
					{ id: "log-4", data: { createdAt: "2026-02-04T00:00:00.000Z" } },
				],
				hasMore: false,
			});

		ctx.storage = {
			delivery_logs: {
				query,
				deleteMany,
			},
		} as any;

		const response = await pluginDefinition.routes.admin.handler(
			{ input: { type: "block_action", action_id: "clear_delivery_logs" } },
			ctx,
		) as any;

		expect(query.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(query).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ orderBy: { createdAt: "asc" }, limit: 500 }),
		);
		expect(query).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ orderBy: { createdAt: "asc" }, limit: 500, cursor: "2" }),
		);
		expect(deleteMany).toHaveBeenCalledWith(["log-1", "log-2", "log-3", "log-4"]);
		expect(response.toast.type).toBe("success");
		expect(response.toast.message).toContain("Cleared 4");
	});
});
