import type { PluginDescriptor } from "emdash";

/**
 * Source-level descriptor used by tests. `emdash-plugin build` regenerates
 * `dist/index.mjs` from `emdash-plugin.jsonc` + `package.json` for publish.
 */
const emdashToBuffer: PluginDescriptor = {
	id: "emdash-to-buffer",
	version: "1.1.1-beta.2",
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

export default emdashToBuffer;
