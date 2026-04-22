import type { PluginContext } from "emdash";

import { discoverChannelIds, sendBufferUpdate } from "./buffer.js";
import { pickBufferImageUrl } from "./images.js";
import { parseProfileIds, renderMessageTemplate } from "./render.js";

// This module contains the main plugin logic for integrating EmDash with Buffer. It defines the event handler for content saves, which checks if a post is being published for the first time and, if so, gathers the necessary information and sends an update to Buffer to create a new post based on the content from EmDash.
interface PublishEvent {
	collection: string;
	before?: {
		status?: string;
		published_at?: string | null;
	};
	content: Record<string, unknown>;
}

interface AdminInteraction {
	type?: string;
	page?: string;
	action_id?: string;
	values?: Record<string, unknown>;
}

// This function normalizes a raw slug value by ensuring it is a string, trimming whitespace, and guaranteeing it starts with a slash. If the input is invalid or empty, it defaults to "/".
function normalizePathSlug(rawSlug: unknown): string {
	const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
	if (!slug) return "/";
	return slug.startsWith("/") ? slug : `/${slug}`;
}

// This function constructs a full URL for the post by combining the site URL and the normalized slug. If the site URL is not provided or if the combination results in an invalid URL, it falls back to returning just the path.
function buildPostUrl(siteUrl: string | null, slug: unknown): string {
	const path = normalizePathSlug(slug);
	if (!siteUrl) return path;
	try {
		return new URL(path, siteUrl).toString();
	} catch {
		return path;
	}
}

// This function determines whether the current save event represents the first time a post is being published. It checks the status of the content before and after the save, as well as the published_at timestamps, to make this determination.
function isFirstPublish(event: PublishEvent): boolean {
	if (event.content.status !== "published") return false;

	if (event.before?.status && event.before.status !== "published") {
		return true;
	}

	const previousPublishedAt = event.before?.published_at ?? null;
	const currentPublishedAt =
		typeof event.content.published_at === "string" ? event.content.published_at : null;

	return previousPublishedAt !== currentPublishedAt;
}

// This function attempts to send a post to Buffer using the provided text, media URL, and channel ID. It implements retry logic with exponential backoff for handling transient errors such as rate limits or server issues, and returns a result indicating success or failure along with any relevant status or error information.
export async function handleAfterSave(event: PublishEvent, ctx: PluginContext): Promise<void> {
	if (event.collection !== "posts") return;
	if (!isFirstPublish(event)) return;

	const enabled = (await ctx.kv.get<boolean>("settings:enabled")) ?? true;
	if (!enabled) return;

	const accessToken = await ctx.kv.get<string>("settings:accessToken");
	const profileList = (await ctx.kv.get<string>("settings:profileIds")) ?? "";
	const messageTemplate = (await ctx.kv.get<string>("settings:messageTemplate")) ?? "{title} {url}";
	const siteUrl = await ctx.kv.get<string>("settings:siteUrl");
	const configuredChannelIds = parseProfileIds(profileList);

	if (!accessToken || !ctx.http) {
		ctx.log.warn("emdash-to-buffer skipped send due to missing settings", {
			hasAccessToken: !!accessToken,
			configuredChannelCount: configuredChannelIds.length,
			hasHttp: !!ctx.http,
		});
		return;
	}

	const channelIds =
		configuredChannelIds.length > 0
			? configuredChannelIds
			: await discoverChannelIds({ fetcher: ctx.http.fetch, accessToken });

	if (channelIds.length === 0) {
		ctx.log.warn("emdash-to-buffer skipped send because no Buffer channels were found", {
			hadConfiguredChannels: configuredChannelIds.length > 0,
		});
		return;
	}

	const url = buildPostUrl(siteUrl ?? null, event.content.slug);
	const text = renderMessageTemplate(messageTemplate, {
		title: typeof event.content.title === "string" ? event.content.title : "",
		url,
		excerpt: typeof event.content.excerpt === "string" ? event.content.excerpt : "",
	});
	const imageUrl = pickBufferImageUrl(event.content) ?? undefined;

	for (const channelId of channelIds) {
		const result = await sendBufferUpdate({
			fetcher: ctx.http.fetch,
			accessToken,
			channelId,
			text,
			mediaUrl: imageUrl,
			log: ctx.log,
		});

		if (!result.ok) {
			await ctx.kv.set("state:lastError", {
				timestamp: new Date().toISOString(),
				channelId,
				status: result.status ?? null,
				error: result.error ?? "unknown",
			});
			ctx.log.error("emdash-to-buffer send failed", {
				channelId,
				status: result.status,
			});
			continue;
		}

		ctx.log.info("emdash-to-buffer send succeeded", {
			channelId,
			status: result.status,
		});
	}
}

async function buildSettingsPage(ctx: PluginContext) {
	const profileIds = (await ctx.kv.get<string>("settings:profileIds")) ?? "";
	const messageTemplate = (await ctx.kv.get<string>("settings:messageTemplate")) ?? "{title} {url}";
	const enabled = (await ctx.kv.get<boolean>("settings:enabled")) ?? true;

	return {
		blocks: [
			{ type: "header", text: "Buffer Settings" },
			{
				type: "section",
				text: "Configure access and posting behavior for Buffer publishing.",
			},
			{ type: "divider" },
			{
				type: "form",
				block_id: "buffer-settings",
				fields: [
					{
						type: "secret_input",
						action_id: "accessToken",
						label: "Buffer Access Token",
					},
					{
						type: "text_input",
						action_id: "profileIds",
						label: "Buffer Channel IDs",
						multiline: true,
						initial_value: profileIds,
					},
					{
						type: "text_input",
						action_id: "messageTemplate",
						label: "Message Template",
						multiline: true,
						initial_value: messageTemplate,
					},
					{
						type: "toggle",
						action_id: "enabled",
						label: "Enable Buffer Posting",
						initial_value: enabled,
					},
				],
				submit: { label: "Save Settings", action_id: "save_settings" },
			},
		],
	};
}

async function saveSettings(ctx: PluginContext, values: Record<string, unknown>) {
	const accessToken = typeof values.accessToken === "string" ? values.accessToken.trim() : "";
	const profileIds = typeof values.profileIds === "string" ? values.profileIds : "";
	const messageTemplate = typeof values.messageTemplate === "string" ? values.messageTemplate : "{title} {url}";
	const enabled = typeof values.enabled === "boolean" ? values.enabled : true;

	if (accessToken.length > 0) {
		await ctx.kv.set("settings:accessToken", accessToken);
	}

	await ctx.kv.set("settings:profileIds", profileIds);
	await ctx.kv.set("settings:messageTemplate", messageTemplate);
	await ctx.kv.set("settings:enabled", enabled);

	return {
		...(await buildSettingsPage(ctx)),
		toast: { type: "success", message: "Settings saved" },
	};
}

export const pluginDefinition = {
	hooks: {
		"content:afterSave": {
			errorPolicy: "continue" as const,
			handler: handleAfterSave,
		},
	},
	routes: {
		admin: {
			handler: async (routeCtx: { input: unknown }, ctx: PluginContext) => {
				const interaction = (routeCtx.input as AdminInteraction | null) ?? null;

				if (interaction?.type === "page_load" && interaction.page === "/settings") {
					return buildSettingsPage(ctx);
				}

				if (interaction?.type === "form_submit" && interaction.action_id === "save_settings") {
					return saveSettings(ctx, interaction.values ?? {});
				}

				return { blocks: [] };
			},
		},
	},
	admin: {
		pages: [{ path: "/settings", label: "Settings", icon: "gear" }],
		settingsSchema: {
			accessToken: {
				type: "secret" as const,
				label: "Buffer Access Token",
				description: "Personal access token used for Buffer API requests.",
			},
			profileIds: {
				type: "string" as const,
				label: "Buffer Channel IDs",
				multiline: true,
				description:
					"Optional. One channel ID per line, or comma-separated values. Leave blank to auto-discover all channels.",
				default: "",
			},
			messageTemplate: {
				type: "string" as const,
				label: "Message Template",
				multiline: true,
				default: "{title} {url}",
			},
			enabled: {
				type: "boolean" as const,
				label: "Enable Buffer Posting",
				default: true,
			},
		},
	},
};
