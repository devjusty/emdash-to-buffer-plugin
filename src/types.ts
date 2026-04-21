export interface BufferTemplateData {
	title: string;
	url: string;
	excerpt: string;
}

export interface BufferSendResult {
	ok: boolean;
	status?: number;
	error?: string;
}
