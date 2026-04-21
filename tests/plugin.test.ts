import { describe, expect, it } from "vitest";

import { emdashToBufferPlugin } from "../src/index.js";
import { pluginDefinition } from "../src/runtime.js";

describe("emdashToBufferPlugin descriptor", () => {
	it("returns a valid PluginDescriptor", () => {
		const descriptor = emdashToBufferPlugin();
		expect(descriptor.id).toBe("emdash-to-buffer");
		expect(descriptor.version).toBe("0.1.0");
		expect(descriptor.format).toBe("standard");
		expect(descriptor.entrypoint).toBe("emdash-to-buffer-plugin/sandbox");
		expect(descriptor.capabilities).toContain("network:fetch");
		expect(descriptor.allowedHosts).toEqual(["api.bufferapp.com"]);
	});

	it("declares settings schema for token, profiles, template, and enabled", () => {
		expect(pluginDefinition.admin.settingsSchema.accessToken.type).toBe("secret");
		expect(pluginDefinition.admin.settingsSchema.profileIds.type).toBe("string");
		expect(pluginDefinition.admin.settingsSchema.messageTemplate.type).toBe("string");
		expect(pluginDefinition.admin.settingsSchema.enabled.type).toBe("boolean");
	});
});
