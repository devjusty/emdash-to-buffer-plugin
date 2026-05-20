import { definePlugin } from "emdash";

import { handleAdminInteraction, pluginDefinition } from "./runtime.js";

export default definePlugin({
	id: "emdash-to-buffer",
	version: "0.1.8-beta.2",
	capabilities: ["content:read", "network:request"],
	allowedHosts: ["api.buffer.com", "api.bufferapp.com"],
	storage: {
		delivery_logs: {
			indexes: ["createdAt", "status", "channelId", "postId", "postSlug"],
		},
	},
	hooks: pluginDefinition.hooks,
	routes: {
		admin: {
			handler: async (routeCtx) => handleAdminInteraction(routeCtx.input as never, routeCtx),
		},
	},
	admin: {
		pages: [{ path: "/settings", label: "Buffer Settings", icon: "gear" }],
		settingsSchema: {
			accessToken: {
				type: "secret" as const,
				label: "Buffer Access Token",
				description: "Personal access token used for Buffer API requests.",
			},
			messageTemplate: {
				type: "string" as const,
				label: "Message Template",
				multiline: true,
				default: "{title}\n{excerpt}\n{url}",
			},
			enabled: {
				type: "boolean" as const,
				label: "Enable Buffer Posting",
				default: true,
			},
		},
	},
});
