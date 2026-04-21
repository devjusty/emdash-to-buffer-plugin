import { describe, expect, it } from "vitest";

import { isRetryableBufferStatus } from "../src/buffer.js";

describe("isRetryableBufferStatus", () => {
	it("retries for 429 and 5xx", () => {
		expect(isRetryableBufferStatus(429)).toBe(true);
		expect(isRetryableBufferStatus(500)).toBe(true);
		expect(isRetryableBufferStatus(503)).toBe(true);
	});

	it("does not retry for non-429 4xx", () => {
		expect(isRetryableBufferStatus(400)).toBe(false);
		expect(isRetryableBufferStatus(401)).toBe(false);
		expect(isRetryableBufferStatus(422)).toBe(false);
	});
});
