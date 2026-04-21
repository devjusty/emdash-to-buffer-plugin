import type { PluginDescriptor } from "emdash";

export function emdashToBufferPlugin(): PluginDescriptor {
	return {
		id: "emdash-to-buffer",
		version: "0.1.0",
		format: "standard",
		entrypoint: "emdash-to-buffer-plugin/sandbox",
		options: {},
		capabilities: ["network:fetch"],
		allowedHosts: ["api.bufferapp.com"],
		adminPages: [],
		adminWidgets: [],
	};
}
