import { describe, expect, it } from "vitest";

import { pickBufferImageUrl } from "../src/images.js";

describe("pickBufferImageUrl", () => {
	it("uses featured image when present", () => {
		expect(
			pickBufferImageUrl({
				featured_image: "https://cdn.example.com/featured.jpg",
				og_image: "https://cdn.example.com/og.jpg",
			}),
		).toBe("https://cdn.example.com/featured.jpg");
	});

	it("falls back to Open Graph image", () => {
		expect(
			pickBufferImageUrl({
				seo_og_image: "https://cdn.example.com/og.jpg",
			}),
		).toBe("https://cdn.example.com/og.jpg");
	});

	it("returns null when no image fields are set", () => {
		expect(pickBufferImageUrl({})).toBeNull();
	});

	it("resolves relative image URLs against siteUrl", () => {
		expect(
			pickBufferImageUrl(
				{
					featured_image:
						"/_emdash/api/media/file/01KNW11TNCSNDKZHNAVGRGB61R.jpg",
				},
				"https://example.com",
			),
		).toBe(
			"https://example.com/_emdash/api/media/file/01KNW11TNCSNDKZHNAVGRGB61R.jpg",
		);
	});

	it("resolves MediaValue objects with storageKey", () => {
		expect(
			pickBufferImageUrl(
				{
					featured_image: {
						provider: "local",
						id: "01ABC",
						meta: { storageKey: "01ABC.jpg" },
					},
				},
				"https://example.com",
			),
		).toBe("https://example.com/_emdash/api/media/file/01ABC.jpg");
	});
});
