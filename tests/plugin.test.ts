import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import emdashToBuffer from "../src/index.js";
import pluginDefault from "../src/plugin.js";
import { pluginDefinition } from "../src/runtime.js";

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageVersion = (JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string })
	.version;

describe("emdash-to-buffer descriptor", () => {
	it("exports a valid PluginDescriptor as default", () => {
		expect(emdashToBuffer.id).toBe("emdash-to-buffer");
		expect(emdashToBuffer.version).toBe(packageVersion);
		expect(emdashToBuffer.format).toBe("standard");
		expect(emdashToBuffer.entrypoint).toBe("emdash-to-buffer-plugin/sandbox");
		expect(emdashToBuffer.capabilities).toContain("content:read");
		expect(emdashToBuffer.capabilities).toContain("network:request");
		expect(emdashToBuffer.allowedHosts).toEqual(["api.buffer.com", "api.bufferapp.com"]);
		expect(emdashToBuffer.adminPages).toEqual([
			{ path: "/settings", label: "Buffer Settings", icon: "gear" },
		]);
		expect(emdashToBuffer.storage?.delivery_logs?.indexes).toEqual([
			"createdAt",
			"status",
			"channelId",
			"postId",
			"postSlug",
		]);
	});

	it("declares sandbox plugin definition hooks and admin route", () => {
		expect(pluginDefinition.hooks["content:afterPublish"]).toBeDefined();
		expect(pluginDefinition.hooks["content:afterSave"]).toBeDefined();
		expect(pluginDefinition.routes.admin).toBeDefined();
		expect(pluginDefault).toBe(pluginDefinition);
	});
});
