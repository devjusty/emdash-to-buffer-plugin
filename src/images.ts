function asString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object") return null;
	return value as Record<string, unknown>;
}

function getContentData(content: Record<string, unknown>): Record<string, unknown> {
	const data = asRecord(content.data);
	return data ?? content;
}

function resolveImageUrl(rawUrl: string, siteUrl: string | null): string | null {
	try {
		const absolute = new URL(rawUrl);
		return absolute.toString();
	} catch {
		if (!siteUrl) return null;
		try {
			return new URL(rawUrl, siteUrl).toString();
		} catch {
			return null;
		}
	}
}

interface BufferImageInspection {
	url: string | null;
	rawUrl: string | null;
	source: string | null;
}

export function inspectBufferImageUrl(
	content: Record<string, unknown>,
	siteUrl: string | null = null,
): BufferImageInspection {
	const data = getContentData(content);
	const seo = asRecord(content.seo) ?? asRecord(data.seo);
	const candidates = [
		{ source: "featured_image", rawUrl: asString(content.featured_image) },
		{ source: "featuredImage", rawUrl: asString(content.featuredImage) },
		{ source: "og_image", rawUrl: asString(content.og_image) },
		{ source: "seo_og_image", rawUrl: asString(content.seo_og_image) },
		{ source: "data.featured_image", rawUrl: asString(data.featured_image) },
		{ source: "data.featuredImage", rawUrl: asString(data.featuredImage) },
		{ source: "data.og_image", rawUrl: asString(data.og_image) },
		{ source: "data.seo_og_image", rawUrl: asString(data.seo_og_image) },
		{ source: "seo.image", rawUrl: asString(seo?.image) },
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
