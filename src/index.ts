import type { PluginDescriptor } from "emdash";

export function emdashToBufferPlugin(): PluginDescriptor {
	return {
		id: "emdash-to-buffer",
    version: "0.1.5-beta.1",
		format: "standard",
		entrypoint: "emdash-to-buffer-plugin/sandbox",
		options: {},
		storage: {
			delivery_logs: {
				indexes: ["createdAt", "status", "channelId", "postId", "postSlug"],
			},
		},
		capabilities: ["read:content", "network:fetch"],
		allowedHosts: ["api.buffer.com", "api.bufferapp.com"],
		adminPages: [{ path: "/settings", label: "Settings", icon: "gear" }],
		adminWidgets: [],
	};
}
