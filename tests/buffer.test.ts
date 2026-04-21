import { describe, expect, it } from "vitest";

import { discoverChannelIds, isRetryableBufferStatus } from "../src/buffer.js";

describe("isRetryableBufferStatus", () => {
	it("retries for 429 and 5xx", () => {
		expect(isRetryableBufferStatus(429)).toBe(true);
		expect(isRetryableBufferStatus(500)).toBe(true);
		expect(isRetryableBufferStatus(503)).toBe(true);
	});

	it("does not retry for non-429 4xx", () => {
		expect(isRetryableBufferStatus(400)).toBe(false);
		expect(isRetryableBufferStatus(401)).toBe(false);
		expect(isRetryableBufferStatus(422)).toBe(false);
	});
});

describe("discoverChannelIds", () => {
	it("discovers channels from organizations", async () => {
		const fetchMock = async (_input: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { query?: string; variables?: Record<string, string> };

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

			return new Response(JSON.stringify({ data: {} }), { status: 200 });
		};

		const channels = await discoverChannelIds({
			fetcher: fetchMock,
			accessToken: "token",
		});

		expect(channels).toEqual(["chan-1", "chan-2"]);
	});
});
