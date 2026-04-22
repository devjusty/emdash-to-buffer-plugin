// This module provides utility functions for working with images in the context of Buffer posts, including extracting image URLs from content objects and handling API interactions related to images.
function asString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

// This function attempts to extract a suitable image URL from the given content object by checking various common properties that might contain image URLs, such as featured_image, og_image, and seo_og_image. It returns the first valid URL found or null if none are present.
export function pickBufferImageUrl(content: Record<string, unknown>): string | null {
	return (
		asString(content.featured_image) ??
		asString(content.featuredImage) ??
		asString(content.og_image) ??
		asString(content.seo_og_image) ??
		null
	);
}
