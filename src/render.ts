import type { BufferTemplateData } from "./types.js";

const tagPattern = /\{([a-zA-Z0-9_]+)\}/g;

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

export function parseProfileIds(input: string): string[] {
	const ids = input
		.split(/[\n,]/g)
		.map((part) => part.trim())
		.filter(Boolean);

	return [...new Set(ids)];
}
