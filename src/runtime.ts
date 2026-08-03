import type { PluginContext } from "emdash";
import type { SandboxedPlugin } from "emdash/plugin";

import {
	type BufferChannel,
	discoverChannels,
	sendBufferUpdate,
} from "./buffer.js";
import { inspectBufferImageUrl } from "./images.js";
import { renderMessageTemplate } from "./render.js";
import type { DeliveryLogRecord } from "./types.js";

interface PublishEvent {
	collection: string;
	isNew?: boolean;
	before?: {
		status?: string;
		published_at?: string | null;
	};
	content: Record<string, unknown>;
}

interface PublishHookEvent {
	collection: string;
	content: Record<string, unknown>;
}

type PublishHookName = "content:afterSave" | "content:afterPublish";

export interface AdminInteraction {
	type?: string;
	page?: string;
	action_id?: string;
	values?: Record<string, unknown>;
}

interface DiscoveryErrorState {
	message: string;
	timestamp: string;
}

function getContentData(
	content: Record<string, unknown>,
): Record<string, unknown> {
	const data = content.data;
	if (data && typeof data === "object") return data as Record<string, unknown>;
	return content;
}

function getContentSeo(
	content: Record<string, unknown>,
): Record<string, unknown> | null {
	if (content.seo && typeof content.seo === "object")
		return content.seo as Record<string, unknown>;
	const data = getContentData(content);
	if (data.seo && typeof data.seo === "object")
		return data.seo as Record<string, unknown>;
	return null;
}

async function pruneDeliveryLogs(
	ctx: PluginContext,
	maxItems: number,
): Promise<void> {
	const deliveryLogs = ctx.storage?.delivery_logs;
	if (!deliveryLogs) return;

	const pageSize = 500;
	let totalCount = 0;
	let cursor: string | undefined;
	const pageIds: string[][] = [];

	while (true) {
		const result = await deliveryLogs.query({
			orderBy: { createdAt: "asc" },
			limit: pageSize,
			...(cursor ? { cursor } : {}),
		});

		const ids = (Array.isArray(result?.items) ? result.items : [])
			.map((item) => (item && typeof item.id === "string" ? item.id : ""))
			.filter(Boolean);
		pageIds.push(ids);
		totalCount += ids.length;

		const nextCursor =
			typeof result?.cursor === "string" && result.cursor.length > 0
				? result.cursor
				: undefined;
		const hasMore = result?.hasMore === true || !!nextCursor;
		if (!hasMore) break;
		if (!nextCursor) break;
		cursor = nextCursor;
	}

	let remainingToDelete = totalCount - maxItems;
	if (remainingToDelete <= 0) return;

	for (const ids of pageIds) {
		if (remainingToDelete <= 0) break;
		const batch = ids.slice(0, remainingToDelete);
		if (batch.length > 0) {
			await deliveryLogs.deleteMany(batch);
			remainingToDelete -= batch.length;
		}
	}
}

async function appendDeliveryLog(
	ctx: PluginContext,
	record: DeliveryLogRecord,
): Promise<void> {
	try {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		await ctx.storage?.delivery_logs?.put(id, record);
		await pruneDeliveryLogs(ctx, 200);
	} catch (error) {
		ctx.log.warn("emdash-to-buffer could not persist delivery log", {
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

function logPublishAttempt(
	ctx: PluginContext,
	hook: PublishHookName,
	collection: string,
	content: Record<string, unknown>,
	metadata: { hasBefore: boolean; isNew: boolean; status: string | null },
) {
	ctx.log.info("emdash-to-buffer publish attempt", {
		hook,
		collection,
		contentId: typeof content.id === "string" ? content.id : undefined,
		contentStatus: metadata.status,
		hasBefore: metadata.hasBefore,
		isNew: metadata.isNew,
	});
}

function resolveAbsoluteUrl(path: string, siteUrl: string | null): string {
	if (!siteUrl) return path;
	try {
		return new URL(path, siteUrl).toString();
	} catch {
		return path;
	}
}

function normalizePostSlug(rawSlug: unknown): string {
	const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
	return slug.replace(/^\/+/, "");
}

function resolvePublishedUrl(
	content: Record<string, unknown>,
	siteUrl: string | null,
): string {
	const seo = getContentSeo(content);
	const canonical =
		seo && typeof seo.canonical === "string" ? seo.canonical.trim() : "";
	if (canonical.length > 0) {
		if (/^https?:\/\//iu.test(canonical)) return canonical;
		const canonicalPath = canonical.startsWith("/")
			? canonical
			: `/${canonical}`;
		return resolveAbsoluteUrl(canonicalPath, siteUrl);
	}

	const slug = normalizePostSlug(content.slug);
	return resolveAbsoluteUrl(`/posts/${slug}`, siteUrl);
}

function isFirstPublish(event: PublishEvent): boolean {
	if (event.content.status !== "published") return false;
	if (event.isNew === true) return true;

	if (!event.before) {
		return false;
	}

	if (event.before.status && event.before.status !== "published") {
		return true;
	}

	return false;
}

function normalizeEnabledChannelIds(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const ids = value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter(Boolean);
	return [...new Set(ids)];
}

function getChannelLabel(channel: BufferChannel): string {
	if (channel.username)
		return `${channel.name} (${channel.service}: ${channel.username})`;
	return `${channel.name} (${channel.service})`;
}

async function loadDiscoveredChannels(
	ctx: PluginContext,
): Promise<BufferChannel[]> {
	const value = await ctx.kv.get<unknown>("state:discoveredChannels");
	if (!Array.isArray(value)) return [];

	const channels: BufferChannel[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const row = item as Record<string, unknown>;
		if (typeof row.id !== "string") continue;
		if (typeof row.name !== "string") continue;
		if (typeof row.service !== "string") continue;

		const channel: BufferChannel = {
			id: row.id,
			name: row.name,
			service: row.service,
		};
		if (typeof row.username === "string") {
			channel.username = row.username;
		}
		channels.push(channel);
	}

	return channels;
}

async function loadRecentDeliveryLogs(
	ctx: PluginContext,
): Promise<DeliveryLogRecord[]> {
	try {
		const deliveryLogs = ctx.storage?.delivery_logs;
		if (!deliveryLogs) return [];

		const result = await deliveryLogs.query({
			orderBy: { createdAt: "desc" },
			limit: 50,
		});

		const items = Array.isArray(result?.items) ? result.items : [];
		const records: DeliveryLogRecord[] = [];
		for (const item of items) {
			if (!item || typeof item !== "object") continue;
			const wrapped = item as Record<string, unknown>;
			if (!wrapped.data || typeof wrapped.data !== "object") continue;
			const row = wrapped.data as Record<string, unknown>;
			if (typeof row.createdAt !== "string") continue;
			if (row.status !== "success" && row.status !== "failed") continue;
			if (typeof row.postId !== "string") continue;
			if (typeof row.postSlug !== "string") continue;
			if (typeof row.channelId !== "string") continue;
			if (typeof row.message !== "string") continue;

			records.push({
				createdAt: row.createdAt,
				status: row.status,
				postId: row.postId,
				postSlug: row.postSlug,
				channelId: row.channelId,
				channelService:
					typeof row.channelService === "string"
						? row.channelService
						: undefined,
				code: typeof row.code === "string" ? row.code : undefined,
				message: row.message,
			});
		}

		return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	} catch (error) {
		ctx.log.warn("emdash-to-buffer could not load delivery logs", {
			message: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

async function clearAllDeliveryLogs(ctx: PluginContext): Promise<number> {
	const deliveryLogs = ctx.storage?.delivery_logs;
	if (!deliveryLogs) return 0;

	const pageSize = 500;
	let cursor: string | undefined;
	const allIds: string[] = [];

	while (true) {
		const result = await deliveryLogs.query({
			orderBy: { createdAt: "asc" },
			limit: pageSize,
			...(cursor ? { cursor } : {}),
		});

		const ids = (Array.isArray(result?.items) ? result.items : [])
			.map((item) => (item && typeof item.id === "string" ? item.id : ""))
			.filter(Boolean);

		if (ids.length > 0) {
			allIds.push(...ids);
		}

		const nextCursor =
			typeof result?.cursor === "string" && result.cursor.length > 0
				? result.cursor
				: undefined;
		const hasMore = result?.hasMore === true || !!nextCursor;
		if (!hasMore) break;
		if (!nextCursor) break;
		cursor = nextCursor;
	}

	if (allIds.length === 0) return 0;

	const uniqueIds = [...new Set(allIds)];
	await deliveryLogs.deleteMany(uniqueIds);
	return uniqueIds.length;
}

function parseDiscoveryError(value: unknown): DiscoveryErrorState | null {
	if (!value || typeof value !== "object") return null;
	const row = value as Record<string, unknown>;
	if (typeof row.message !== "string") return null;
	if (typeof row.timestamp !== "string") return null;
	return { message: row.message, timestamp: row.timestamp };
}

async function discoverAndPersistChannels(
	ctx: PluginContext,
	accessToken: string,
): Promise<BufferChannel[]> {
	if (!ctx.http) return [];
	try {
		const channels = await discoverChannels({
			fetcher: ctx.http.fetch,
			accessToken,
		});
		await ctx.kv.set("state:discoveredChannels", channels);
		await ctx.kv.set("state:discoveredAt", new Date().toISOString());
		await ctx.kv.set("state:lastDiscoveryError", null);
		return channels;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await ctx.kv.set("state:lastDiscoveryError", {
			message,
			timestamp: new Date().toISOString(),
		});
		ctx.log.error("emdash-to-buffer channel discovery failed", { message });
		return [];
	}
}

async function getChannelsForPublishing(
	ctx: PluginContext,
	accessToken: string,
): Promise<BufferChannel[]> {
	const explicit = normalizeEnabledChannelIds(
		await ctx.kv.get<unknown>("settings:enabledChannelIds"),
	);
	const cached = await loadDiscoveredChannels(ctx);
	if (explicit) {
		if (explicit.length === 0) return [];
		if (cached.length === 0) {
			const discovered = await discoverAndPersistChannels(ctx, accessToken);
			const selected = new Set(explicit);
			return discovered.filter((channel) => selected.has(channel.id));
		}
		const selected = new Set(explicit);
		return cached.filter((channel) => selected.has(channel.id));
	}

	if (cached.length > 0) return cached;

	const discovered = await discoverAndPersistChannels(ctx, accessToken);
	return discovered;
}

export async function handleAfterSave(
	event: PublishEvent,
	ctx: PluginContext,
): Promise<void> {
	if (event.collection !== "posts") return;
	if (!isFirstPublish(event)) return;
	await handlePublishedContent(
		event.collection,
		event.content,
		ctx,
		"content:afterSave",
		{
			hasBefore: !!event.before,
			isNew: event.isNew === true,
		},
	);
}

export async function handleAfterPublish(
	event: PublishHookEvent,
	ctx: PluginContext,
): Promise<void> {
	if (event.collection !== "posts") return;
	await handlePublishedContent(
		event.collection,
		event.content,
		ctx,
		"content:afterPublish",
		{
			hasBefore: false,
			isNew: false,
		},
	);
}

async function handlePublishedContent(
	collection: string,
	content: Record<string, unknown>,
	ctx: PluginContext,
	hook: PublishHookName,
	metadata: { hasBefore: boolean; isNew: boolean },
): Promise<void> {
	if (content.status !== "published") return;

	const postId = typeof content.id === "string" ? content.id : "";
	const postSlug = typeof content.slug === "string" ? content.slug : "";
	logPublishAttempt(ctx, hook, collection, content, {
		hasBefore: metadata.hasBefore,
		isNew: metadata.isNew,
		status: typeof content.status === "string" ? content.status : null,
	});

	const enabled = (await ctx.kv.get<boolean>("settings:enabled")) ?? true;
	if (!enabled) {
		await appendDeliveryLog(ctx, {
			createdAt: new Date().toISOString(),
			status: "failed",
			postId,
			postSlug,
			channelId: "-",
			message: "Buffer posting is disabled in plugin settings",
		});
		return;
	}

	const accessToken = await ctx.kv.get<string>("settings:accessToken");
	if (!accessToken || !ctx.http) {
		ctx.log.warn("emdash-to-buffer skipped send due to missing settings", {
			hasAccessToken: !!accessToken,
			hasHttp: !!ctx.http,
		});
		await appendDeliveryLog(ctx, {
			createdAt: new Date().toISOString(),
			status: "failed",
			postId,
			postSlug,
			channelId: "-",
			message: !accessToken
				? "Missing Buffer access token in plugin settings"
				: "Plugin HTTP access is unavailable",
		});
		return;
	}

	const channels = await getChannelsForPublishing(ctx, accessToken);
	if (channels.length === 0) {
		ctx.log.warn(
			"emdash-to-buffer skipped send because no Buffer channels are enabled",
		);
		await appendDeliveryLog(ctx, {
			createdAt: new Date().toISOString(),
			status: "failed",
			postId,
			postSlug,
			channelId: "-",
			message: "No enabled Buffer channels found",
		});
		return;
	}

	const messageTemplate =
		(await ctx.kv.get<string>("settings:messageTemplate")) ??
		"{title}\n{excerpt}\n{url}";
	const siteUrl =
		ctx.site.url || (await ctx.kv.get<string>("settings:siteUrl")) || null;
	const url = resolvePublishedUrl(content, siteUrl);
	const contentData = getContentData(content);
	const imageInspection = inspectBufferImageUrl(content, siteUrl);
	const imageUrl = imageInspection.url;
	const imageDebug = {
		contentKeys: Object.keys(content),
		dataKeys: contentData !== content ? Object.keys(contentData) : [],
		seoKeys:
			content.seo && typeof content.seo === "object"
				? Object.keys(content.seo as Record<string, unknown>)
				: contentData.seo && typeof contentData.seo === "object"
					? Object.keys(contentData.seo as Record<string, unknown>)
					: [],
		pickedImageUrl: imageUrl ?? null,
		pickedImageSource: imageInspection.source,
		rawImageUrl: imageInspection.rawUrl,
		postUrl: url,
	};
	ctx.log.info("emdash-to-buffer image extraction", imageDebug);
	const text = renderMessageTemplate(messageTemplate, {
		title: typeof contentData.title === "string" ? contentData.title : "",
		url,
		excerpt: typeof contentData.excerpt === "string" ? contentData.excerpt : "",
	});
	ctx.log.info("emdash-to-buffer publish payload", {
		postId,
		postSlug,
		channelCount: channels.length,
		textLength: text.length,
		postUrl: url,
		imageUrl,
		imageSource: imageInspection.source,
	});
	for (const channel of channels) {
		const channelId = channel.id;
		const result = await sendBufferUpdate({
			fetcher: ctx.http.fetch,
			accessToken,
			channelId,
			channelService: channel.service,
			postUrl: url,
			text,
			mediaUrl: imageUrl ?? undefined,
			log: ctx.log,
		});

		if (!result.ok) {
			await ctx.kv.set("state:lastError", {
				timestamp: new Date().toISOString(),
				channelId,
				channelService: channel.service,
				status: result.status ?? null,
				error: result.error ?? "unknown",
			});
			ctx.log.error("emdash-to-buffer send failed", {
				channelId,
				channelService: channel.service,
				status: result.status,
				error: result.error,
			});
			await appendDeliveryLog(ctx, {
				createdAt: new Date().toISOString(),
				status: "failed",
				postId,
				postSlug,
				channelId,
				channelService: channel.service,
				code:
					typeof result.status === "number" ? String(result.status) : undefined,
				message: result.error ?? "Unknown error",
			});
			continue;
		}

		ctx.log.info("emdash-to-buffer send succeeded", {
			channelId,
			channelService: channel.service,
			status: result.status,
			postUrl: url,
			imageUrl,
		});
		await appendDeliveryLog(ctx, {
			createdAt: new Date().toISOString(),
			status: "success",
			postId,
			postSlug,
			channelId,
			channelService: channel.service,
			code:
				typeof result.status === "number" ? String(result.status) : undefined,
			message: "Queued in Buffer",
		});
	}
}

async function buildSettingsPage(
	ctx: PluginContext,
	options?: { refresh?: boolean },
) {
	const accessToken = await ctx.kv.get<string>("settings:accessToken");
	const messageTemplate =
		(await ctx.kv.get<string>("settings:messageTemplate")) ??
		"{title}\n{excerpt}\n{url}";
	const enabled = (await ctx.kv.get<boolean>("settings:enabled")) ?? true;
	const savedEnabledChannelIds = normalizeEnabledChannelIds(
		await ctx.kv.get<unknown>("settings:enabledChannelIds"),
	);

	let channels = await loadDiscoveredChannels(ctx);
	if (accessToken && ctx.http && (options?.refresh || channels.length === 0)) {
		channels = await discoverAndPersistChannels(ctx, accessToken);
	}

	const channelIds = channels.map((channel) => channel.id);
	const selectedChannelIds =
		savedEnabledChannelIds === null
			? channelIds
			: savedEnabledChannelIds.filter((id) => channelIds.includes(id));
	const selectedSet = new Set<string>(selectedChannelIds);

	const lastDiscoveredAt = await ctx.kv.get<string>("state:discoveredAt");
	const discoveryError = parseDiscoveryError(
		await ctx.kv.get<unknown>("state:lastDiscoveryError"),
	);
	const deliveryLogs = await loadRecentDeliveryLogs(ctx);

	return {
		blocks: [
			{ type: "header", text: "Emdash to Buffer Settings" },
			{
				type: "section",
				text: "Configure access and posting behavior for Buffer publishing.",
			},
			{
				type: "section",
				text: accessToken
					? "Discover channels from your Buffer account, then toggle which channels receive posts."
					: "Save your Buffer access token first, then click Discover channels.",
				accessory: {
					type: "button",
					action_id: "discover_channels",
					label: "Discover channels",
					style: "secondary",
				},
			},
			{
				type: "fields",
				fields: [
					{
						label: "Access token",
						value: accessToken ? "Configured" : "Not configured",
					},
					{ label: "Discovered channels", value: String(channels.length) },
					{
						label: "Last discovery",
						value:
							lastDiscoveredAt && lastDiscoveredAt.length > 0
								? lastDiscoveredAt
								: "Never",
					},
					{
						label: "Last discovery error",
						value: discoveryError?.message ?? "None",
					},
				],
			},
			{
				type: "table",
				block_id: "channels-table",
				page_action_id: "channels_table_page",
				columns: [
					{ key: "name", label: "Channel", format: "text" },
					{ key: "service", label: "Network", format: "badge" },
					{ key: "id", label: "Channel ID", format: "code" },
					{ key: "enabled", label: "Enabled", format: "badge" },
				],
				rows:
					channels.length > 0
						? channels.map((channel) => ({
								name: channel.username
									? `${channel.name} (@${channel.username})`
									: channel.name,
								service: channel.service,
								id: channel.id,
								enabled: selectedSet.has(channel.id) ? "on" : "off",
							}))
						: [
								{
									name: "No channels discovered yet",
									service: "-",
									id: "-",
									enabled: "off",
								},
							],
			},
			{
				type: "section",
				text: "Review recent publish attempts and clear logs when you want a fresh history.",
				accessory: {
					type: "button",
					action_id: "clear_delivery_logs",
					label: "Clear logs",
					style: "secondary",
				},
			},
			{
				type: "table",
				block_id: "delivery-log-table",
				columns: [
					{ key: "when", label: "When", format: "text" },
					{ key: "post", label: "Post", format: "text" },
					{ key: "channel", label: "Channel", format: "code" },
					{ key: "status", label: "Status", format: "badge" },
					{ key: "code", label: "Code", format: "code" },
					{ key: "message", label: "Message", format: "text" },
				],
				rows:
					deliveryLogs.length > 0
						? deliveryLogs.map((row) => ({
								when: row.createdAt,
								post: row.postSlug || row.postId || "-",
								channel: row.channelId,
								status: row.status,
								code: row.code ?? "-",
								message: row.message,
							}))
						: [
								{
									when: "-",
									post: "-",
									channel: "-",
									status: "-",
									code: "-",
									message: "No delivery logs yet",
								},
							],
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
						has_value: !!accessToken,
					},
					{
						type: "checkbox",
						action_id: "enabledChannelIds",
						label: "Enabled channels",
						options: channels.map((channel) => ({
							label: getChannelLabel(channel),
							value: channel.id,
						})),
						initial_value: selectedChannelIds,
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

async function saveSettings(
	ctx: PluginContext,
	values: Record<string, unknown>,
) {
	const accessToken =
		typeof values.accessToken === "string" ? values.accessToken.trim() : "";
	const enabledChannelIds =
		normalizeEnabledChannelIds(values.enabledChannelIds) ?? [];
	const messageTemplate =
		typeof values.messageTemplate === "string"
			? values.messageTemplate
			: "{title}\n{excerpt}\n{url}";
	const enabled = typeof values.enabled === "boolean" ? values.enabled : true;

	if (accessToken.length > 0) {
		await ctx.kv.set("settings:accessToken", accessToken);
	}

	await ctx.kv.set("settings:enabledChannelIds", enabledChannelIds);
	await ctx.kv.set("settings:messageTemplate", messageTemplate);
	await ctx.kv.set("settings:enabled", enabled);

	return {
		...(await buildSettingsPage(ctx)),
		toast: { type: "success", message: "Settings saved" },
	};
}

export async function handleAdminInteraction(
	interaction: AdminInteraction | null,
	ctx: PluginContext,
) {
	if (interaction?.type === "page_load" && interaction.page === "/settings") {
		return buildSettingsPage(ctx);
	}

	if (
		interaction?.type === "block_action" &&
		interaction.action_id === "discover_channels"
	) {
		const accessToken = await ctx.kv.get<string>("settings:accessToken");
		if (!accessToken || !ctx.http) {
			return {
				...(await buildSettingsPage(ctx)),
				toast: {
					type: "error",
					message: "Add and save your Buffer access token first.",
				},
			};
		}

		const channels = await discoverAndPersistChannels(ctx, accessToken);
		const isError = channels.length === 0;
		const discoveryError = parseDiscoveryError(
			await ctx.kv.get<unknown>("state:lastDiscoveryError"),
		);
		return {
			...(await buildSettingsPage(ctx)),
			toast: {
				type: isError ? "error" : "success",
				message: isError
					? (discoveryError?.message ??
						"No Buffer channels found. Verify token permissions and connected channels in Buffer.")
					: `Discovered ${channels.length} Buffer channel${channels.length === 1 ? "" : "s"}.`,
			},
		};
	}

	if (
		interaction?.type === "block_action" &&
		interaction.action_id === "clear_delivery_logs"
	) {
		const clearedCount = await clearAllDeliveryLogs(ctx);
		return {
			...(await buildSettingsPage(ctx)),
			toast: {
				type: "success",
				message: `Cleared ${clearedCount} delivery log${clearedCount === 1 ? "" : "s"}.`,
			},
		};
	}

	if (
		interaction?.type === "form_submit" &&
		interaction.action_id === "save_settings"
	) {
		return saveSettings(ctx, interaction.values ?? {});
	}

	return { blocks: [] };
}

export const pluginDefinition = {
	hooks: {
		"content:afterSave": {
			errorPolicy: "continue" as const,
			handler: handleAfterSave,
		},
		"content:afterPublish": {
			errorPolicy: "continue" as const,
			handler: handleAfterPublish,
		},
	},
	routes: {
		admin: {
			handler: async (routeCtx: { input: unknown }, ctx: PluginContext) => {
				const interaction = (routeCtx.input as AdminInteraction | null) ?? null;
				return handleAdminInteraction(interaction, ctx);
			},
		},
	},
} satisfies SandboxedPlugin;
