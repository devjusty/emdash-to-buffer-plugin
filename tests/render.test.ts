import { describe, expect, it } from "vitest";

import { parseProfileIds, renderMessageTemplate } from "../src/render.js";

describe("renderMessageTemplate", () => {
	it("renders title, url, excerpt, and strips unknown tags", () => {
		const rendered = renderMessageTemplate("{title} {url} {excerpt} {bad}", {
			title: "Hello",
			url: "https://example.com/posts/hello",
			excerpt: "World",
		});

		expect(rendered).toBe("Hello https://example.com/posts/hello World");
	});
});

describe("parseProfileIds", () => {
	it("normalizes csv/newline input and deduplicates", () => {
		expect(parseProfileIds("abc\n def,abc,ghi ")).toEqual(["abc", "def", "ghi"]);
	});
});
