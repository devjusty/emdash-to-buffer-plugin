// This module provides utility functions for working with images in the context of Buffer posts, including extracting image URLs from content objects and handling API interactions related to images.
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

// This function attempts to extract a suitable image URL from the given content object by checking various common properties that might contain image URLs, such as featured_image, og_image, and seo_og_image. It returns the first valid URL found or null if none are present.
export function pickBufferImageUrl(content: Record<string, unknown>): string | null {
	const data = getContentData(content);
	const seo = asRecord(content.seo) ?? asRecord(data.seo);
	return (
		asString(content.featured_image) ??
		asString(content.featuredImage) ??
		asString(content.og_image) ??
		asString(content.seo_og_image) ??
		asString(data.featured_image) ??
		asString(data.featuredImage) ??
		asString(data.og_image) ??
		asString(data.seo_og_image) ??
		asString(seo?.image) ??
		null
	);
}
