import type { BufferTemplateData } from "./types.js";

const tagPattern = /\{([a-zA-Z0-9_]+)\}/g;

// This module provides functions for rendering message templates with dynamic data and parsing profile IDs from user input, which are used in the process of creating Buffer posts based on content from EmDash.
export function renderMessageTemplate(template: string, data: BufferTemplateData): string {
	const rendered = template.replaceAll(tagPattern, (_full, rawTag: string) => {
		const tag = rawTag.toLowerCase();
		if (tag === "title") return data.title;
		if (tag === "url") return data.url;
		if (tag === "excerpt") return data.excerpt;
		return "";
	});

	return rendered.replaceAll(/\s+/g, " ").trim();
}

// This function parses a string containing profile IDs separated by newlines or commas and returns an array of unique, trimmed IDs.
export function parseProfileIds(input: string): string[] {
	const ids = input
		.split(/[\n,]/g)
		.map((part) => part.trim())
		.filter(Boolean);

	return [...new Set(ids)];
}
