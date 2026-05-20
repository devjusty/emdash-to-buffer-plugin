import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { emdashToBufferPlugin } from "../src/index.js";
import nativePlugin from "../src/native-entry.js";
import { pluginDefinition } from "../src/runtime.js";

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageVersion = (JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string }).version;

describe("emdashToBufferPlugin descriptor", () => {
	it("returns a valid PluginDescriptor", () => {
		const descriptor = emdashToBufferPlugin();
		expect(descriptor.id).toBe("emdash-to-buffer");
		expect(descriptor.version).toBe(packageVersion);
		expect(descriptor.format).toBe("standard");
		expect(descriptor.entrypoint).toBe("emdash-to-buffer-plugin/sandbox");
		expect(descriptor.capabilities).toContain("content:read");
		expect(descriptor.capabilities).toContain("network:request");
		expect(descriptor.allowedHosts).toEqual(["api.buffer.com", "api.bufferapp.com"]);
		expect(descriptor.adminPages).toEqual([
			{ path: "/settings", label: "Buffer Settings", icon: "gear" },
		]);
		expect(descriptor.storage?.delivery_logs?.indexes).toEqual([
			"createdAt",
			"status",
			"channelId",
			"postId",
			"postSlug",
		]);
	});

	it("declares settings schema for token, template, and enabled", () => {
		expect(pluginDefinition.hooks["content:afterPublish"]).toBeDefined();
		expect(pluginDefinition.routes.admin).toBeDefined();
		expect(nativePlugin.id).toBe("emdash-to-buffer");
		expect(nativePlugin.version).toBe(packageVersion);
		expect(nativePlugin.admin?.settingsSchema?.accessToken?.type).toBe("secret");
		expect(nativePlugin.admin?.settingsSchema?.messageTemplate?.type).toBe("string");
		expect((nativePlugin.admin?.settingsSchema?.messageTemplate as { default?: string } | undefined)?.default).toBe(
			"{title}\n{excerpt}\n{url}",
		);
		expect(nativePlugin.admin?.settingsSchema?.enabled?.type).toBe("boolean");
		expect(nativePlugin.admin?.pages).toEqual([
			{ path: "/settings", label: "Buffer Settings", icon: "gear" },
		]);
	});
});
