import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { emdashToBufferPlugin } from "../src/index.js";
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
		expect(descriptor.capabilities).toContain("read:content");
		expect(descriptor.capabilities).toContain("network:fetch");
		expect(descriptor.allowedHosts).toEqual(["api.buffer.com", "api.bufferapp.com"]);
	});

	it("declares settings schema for token, profiles, template, and enabled", () => {
		expect(pluginDefinition.admin.settingsSchema.accessToken.type).toBe("secret");
		expect(pluginDefinition.admin.settingsSchema.profileIds.type).toBe("string");
		expect(pluginDefinition.admin.settingsSchema.messageTemplate.type).toBe("string");
		expect(pluginDefinition.admin.settingsSchema.enabled.type).toBe("boolean");
	});
});
