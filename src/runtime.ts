import type { PluginContext } from "emdash";

import { discoverChannels, sendBufferUpdate, type BufferChannel } from "./buffer.js";
import { pickBufferImageUrl } from "./images.js";
import { renderMessageTemplate } from "./render.js";

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

interface DiscoveryErrorState {
	message: string;
	timestamp: string;
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

function normalizeEnabledChannelIds(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const ids = value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter(Boolean);
	return [...new Set(ids)];
}

function getChannelLabel(channel: BufferChannel): string {
	if (channel.username) return `${channel.name} (${channel.service}: ${channel.username})`;
	return `${channel.name} (${channel.service})`;
}

async function loadDiscoveredChannels(ctx: PluginContext): Promise<BufferChannel[]> {
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

function parseDiscoveryError(value: unknown): DiscoveryErrorState | null {
	if (!value || typeof value !== "object") return null;
	const row = value as Record<string, unknown>;
	if (typeof row.message !== "string") return null;
	if (typeof row.timestamp !== "string") return null;
	return { message: row.message, timestamp: row.timestamp };
}

async function discoverAndPersistChannels(ctx: PluginContext, accessToken: string): Promise<BufferChannel[]> {
	if (!ctx.http) return [];
	try {
		const channels = await discoverChannels({ fetcher: ctx.http.fetch, accessToken });
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

async function getChannelsForPublishing(ctx: PluginContext, accessToken: string): Promise<string[]> {
	const explicit = normalizeEnabledChannelIds(await ctx.kv.get<unknown>("settings:enabledChannelIds"));
	if (explicit) return explicit;

	const cached = await loadDiscoveredChannels(ctx);
	if (cached.length > 0) return cached.map((channel) => channel.id);

	const discovered = await discoverAndPersistChannels(ctx, accessToken);
	return discovered.map((channel) => channel.id);
}

export async function handleAfterSave(event: PublishEvent, ctx: PluginContext): Promise<void> {
	if (event.collection !== "posts") return;
	if (!isFirstPublish(event)) return;

	const enabled = (await ctx.kv.get<boolean>("settings:enabled")) ?? true;
	if (!enabled) return;

	const accessToken = await ctx.kv.get<string>("settings:accessToken");
	if (!accessToken || !ctx.http) {
		ctx.log.warn("emdash-to-buffer skipped send due to missing settings", {
			hasAccessToken: !!accessToken,
			hasHttp: !!ctx.http,
		});
		return;
	}

	const channelIds = await getChannelsForPublishing(ctx, accessToken);
	if (channelIds.length === 0) {
		ctx.log.warn("emdash-to-buffer skipped send because no Buffer channels are enabled");
		return;
	}

	const messageTemplate = (await ctx.kv.get<string>("settings:messageTemplate")) ?? "{title} {url}";
	const siteUrl = await ctx.kv.get<string>("settings:siteUrl");
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
			ctx.log.error("emdash-to-buffer send failed", { channelId, status: result.status });
			continue;
		}

		ctx.log.info("emdash-to-buffer send succeeded", { channelId, status: result.status });
	}
}

async function buildSettingsPage(ctx: PluginContext, options?: { refresh?: boolean }) {
	const accessToken = await ctx.kv.get<string>("settings:accessToken");
	const messageTemplate = (await ctx.kv.get<string>("settings:messageTemplate")) ?? "{title} {url}";
	const enabled = (await ctx.kv.get<boolean>("settings:enabled")) ?? true;
	const savedEnabledChannelIds =
		normalizeEnabledChannelIds(await ctx.kv.get<unknown>("settings:enabledChannelIds")) ?? [];

	let channels = await loadDiscoveredChannels(ctx);
	if (accessToken && ctx.http && (options?.refresh || channels.length === 0)) {
		channels = await discoverAndPersistChannels(ctx, accessToken);
	}

	const channelIds = channels.map((channel) => channel.id);
	const selectedChannelIds =
		savedEnabledChannelIds.length > 0
			? savedEnabledChannelIds.filter((id) => channelIds.includes(id))
			: channelIds;
	const selectedSet = new Set<string>(selectedChannelIds);

	const lastDiscoveredAt = await ctx.kv.get<string>("state:discoveredAt");
	const discoveryError = parseDiscoveryError(await ctx.kv.get<unknown>("state:lastDiscoveryError"));

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
					{ label: "Access token", value: accessToken ? "Configured" : "Not configured" },
					{ label: "Discovered channels", value: String(channels.length) },
					{
						label: "Last discovery",
						value: lastDiscoveredAt && lastDiscoveredAt.length > 0 ? lastDiscoveredAt : "Never",
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

async function saveSettings(ctx: PluginContext, values: Record<string, unknown>) {
	const accessToken = typeof values.accessToken === "string" ? values.accessToken.trim() : "";
	const enabledChannelIds = normalizeEnabledChannelIds(values.enabledChannelIds) ?? [];
	const messageTemplate =
		typeof values.messageTemplate === "string" ? values.messageTemplate : "{title} {url}";
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

				if (interaction?.type === "block_action" && interaction.action_id === "discover_channels") {
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
