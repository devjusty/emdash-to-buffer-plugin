import type { PluginDescriptor } from "emdash";

export function emdashToBufferPlugin(): PluginDescriptor {
	return {
		id: "emdash-to-buffer",
		version: "1.0.0",
		format: "standard",
		entrypoint: "emdash-to-buffer-plugin/sandbox",
		options: {},
		storage: {
			delivery_logs: {
				indexes: ["createdAt", "status", "channelId", "postId", "postSlug"],
			},
		},
		capabilities: ["content:read", "network:request"],
		allowedHosts: ["api.buffer.com", "api.bufferapp.com"],
		adminPages: [{ path: "/settings", label: "Buffer Settings", icon: "gear" }],
		adminWidgets: [],
	};
}
