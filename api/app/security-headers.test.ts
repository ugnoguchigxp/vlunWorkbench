import { describe, expect, it } from "vitest";
import {
	appContentSecurityPolicy,
	serializeContentSecurityPolicy,
} from "./security-headers";

describe("serializeContentSecurityPolicy", () => {
	it("serializes camel-case and acronym directives", () => {
		expect(
			serializeContentSecurityPolicy({
				URLValue: ["'self'"],
				defaultSrc: ["'self'", "data:"],
			}),
		).toBe("url-value 'self'; default-src 'self' data:");
	});

	it("serializes the application policy", () => {
		const value = serializeContentSecurityPolicy(appContentSecurityPolicy);
		expect(value).toContain("frame-ancestors 'self'");
		expect(value).toContain("object-src 'none'");
	});
});
