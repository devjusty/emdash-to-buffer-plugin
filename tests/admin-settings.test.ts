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
							{ id: "chan-1", name: "Main X", service: "twitter", serviceUsername: "main" },
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
});
