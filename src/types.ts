// This file defines TypeScript interfaces for the data structures used in the EmDash to Buffer plugin.
export interface BufferTemplateData {
	title: string;
	url: string;
	excerpt: string;
}

// This interface represents the result of sending a post to Buffer, including whether it was successful and any relevant status or error information.
export interface BufferSendResult {
	ok: boolean;
	status?: number;
	error?: string;
}
