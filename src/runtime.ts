import type { PluginContext } from "emdash";

import { discoverChannelIds, sendBufferUpdate } from "./buffer.js";
import { pickBufferImageUrl } from "./images.js";
import { parseProfileIds, renderMessageTemplate } from "./render.js";

interface PublishEvent {
	collection: string;
	before?: {
		status?: string;
		published_at?: string | null;
	};
	content: Record<string, unknown>;
}

function normalizePathSlug(rawSlug: unknown): string {
	const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
	if (!slug) return "/";
	return slug.startsWith("/") ? slug : `/${slug}`;
}

function buildPostUrl(siteUrl: string | null, slug: unknown): string {
	const path = normalizePathSlug(slug);
	if (!siteUrl) return path;
	try {
		return new URL(path, siteUrl).toString();
	} catch {
		return path;
	}
}

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

export const pluginDefinition = {
	hooks: {
		"content:afterSave": {
			errorPolicy: "continue" as const,
			handler: handleAfterSave,
		},
	},
	admin: {
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
