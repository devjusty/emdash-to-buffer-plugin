function asString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function pickBufferImageUrl(content: Record<string, unknown>): string | null {
	return (
		asString(content.featured_image) ??
		asString(content.featuredImage) ??
		asString(content.og_image) ??
		asString(content.seo_og_image) ??
		null
	);
}
