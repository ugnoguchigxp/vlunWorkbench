import { createHash } from "node:crypto";
import { test as base, expect } from "@playwright/test";

type E2EFixtures = {
	rateLimitIsolation: undefined;
};

export const test = base.extend<E2EFixtures>({
	rateLimitIsolation: [
		async ({ context }, use, testInfo) => {
			const digest = createHash("sha256").update(testInfo.testId).digest();
			const clientIp = `198.18.${digest[0]}.${digest[1] || 1}`;
			await context.setExtraHTTPHeaders({ "X-Forwarded-For": clientIp });
			await use(undefined);
		},
		{ auto: true },
	],
});

export type { Page } from "@playwright/test";
export { expect };
