import type { PluginContext } from "emdash";

import { sendBufferUpdate } from "./buffer.js";
import { pickBufferImageUrl } from "./images.js";
import { parseProfileIds, renderMessageTemplate } from "./render.js";

export interface PublishEvent {
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

export function isFirstPublish(event: PublishEvent): boolean {
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
	const profileIds = parseProfileIds(profileList);

	if (!accessToken || profileIds.length === 0 || !ctx.http) {
		ctx.log.warn("emdash-to-buffer skipped send due to missing settings", {
			hasAccessToken: !!accessToken,
			profileCount: profileIds.length,
			hasHttp: !!ctx.http,
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

	for (const profileId of profileIds) {
		const result = await sendBufferUpdate({
			fetcher: ctx.http.fetch,
			accessToken,
			profileId,
			text,
			mediaUrl: imageUrl,
			log: ctx.log,
		});

		if (!result.ok) {
			await ctx.kv.set("state:lastError", {
				timestamp: new Date().toISOString(),
				profileId,
				status: result.status ?? null,
				error: result.error ?? "unknown",
			});
			ctx.log.error("emdash-to-buffer send failed", {
				profileId,
				status: result.status,
			});
			continue;
		}

		ctx.log.info("emdash-to-buffer send succeeded", {
			profileId,
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
				label: "Buffer Profile IDs",
				multiline: true,
				description: "One profile ID per line, or comma-separated values.",
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
