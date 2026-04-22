import type { PluginDescriptor } from "emdash";

export function emdashToBufferPlugin(): PluginDescriptor {
	return {
		id: "emdash-to-buffer",
    version: "0.1.4-beta.3",
		format: "standard",
		entrypoint: "emdash-to-buffer-plugin/sandbox",
		options: {},
		capabilities: ["read:content", "network:fetch"],
		allowedHosts: ["api.buffer.com", "api.bufferapp.com"],
		adminPages: [{ path: "/settings", label: "Settings", icon: "gear" }],
		adminWidgets: [],
	};
}
