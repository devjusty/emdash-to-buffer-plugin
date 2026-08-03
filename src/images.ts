function asString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object") return null;
	return value as Record<string, unknown>;
}

function resolveImageUrl(
	rawUrl: string,
	siteUrl: string | null,
): string | null {
	try {
		return new URL(rawUrl).toString();
	} catch {
		if (!siteUrl) return null;
		try {
			return new URL(rawUrl, siteUrl).toString();
		} catch {
			return null;
		}
	}
}

function getContentData(
	content: Record<string, unknown>,
): Record<string, unknown> {
	const data = asRecord(content.data);
	return data ?? content;
}

interface BufferImageInspection {
	url: string | null;
	rawUrl: string | null;
	source: string | null;
}

function extractCandidateUrl(value: unknown): string | null {
	if (typeof value === "string") return value;
	const record = asRecord(value);
	if (!record) return null;

	const directUrl =
		asString(record.src) ?? asString(record.previewUrl) ?? asString(record.url);
	if (directUrl) return directUrl;

	const media = asRecord(record.$media);
	if (media) {
		return (
			asString(media.url) ?? asString(media.src) ?? asString(media.previewUrl)
		);
	}

	const provider = asString(record.provider)?.toLowerCase() ?? "";
	if (provider === "local") {
		const storageKey = asString(
			record.meta && asRecord(record.meta)?.storageKey,
		);
		if (storageKey) return `/_emdash/api/media/file/${storageKey}`;
		const id = asString(record.id);
		if (id) return `/_emdash/api/media/file/${id}`;
	}

	return null;
}

export function inspectBufferImageUrl(
	content: Record<string, unknown>,
	siteUrl: string | null = null,
): BufferImageInspection {
	const data = getContentData(content);
	const seo = asRecord(content.seo) ?? asRecord(data.seo);
	const candidates = [
		{
			source: "featured_image",
			rawUrl: extractCandidateUrl(content.featured_image),
		},
		{
			source: "featuredImage",
			rawUrl: extractCandidateUrl(content.featuredImage),
		},
		{ source: "og_image", rawUrl: extractCandidateUrl(content.og_image) },
		{
			source: "seo_og_image",
			rawUrl: extractCandidateUrl(content.seo_og_image),
		},
		{
			source: "data.featured_image",
			rawUrl: extractCandidateUrl(data.featured_image),
		},
		{
			source: "data.featuredImage",
			rawUrl: extractCandidateUrl(data.featuredImage),
		},
		{ source: "data.og_image", rawUrl: extractCandidateUrl(data.og_image) },
		{
			source: "data.seo_og_image",
			rawUrl: extractCandidateUrl(data.seo_og_image),
		},
		{ source: "seo.image", rawUrl: extractCandidateUrl(seo?.image) },
	];

	for (const candidate of candidates) {
		if (!candidate.rawUrl) continue;
		const url = resolveImageUrl(candidate.rawUrl, siteUrl);
		if (!url) continue;
		return { url, rawUrl: candidate.rawUrl, source: candidate.source };
	}

	return { url: null, rawUrl: null, source: null };
}

export function pickBufferImageUrl(
	content: Record<string, unknown>,
	siteUrl: string | null = null,
): string | null {
	return inspectBufferImageUrl(content, siteUrl).url;
}
