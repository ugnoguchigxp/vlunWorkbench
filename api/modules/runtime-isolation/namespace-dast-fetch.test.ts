import { describe, expect, it } from "vitest";
import { createNamespaceDastFetch } from "./namespace-dast-fetch";

describe("namespace DAST fetch", () => {
	it("sends headers as Docker environment values while keeping the request inside the owner namespace", async () => {
		let argv: string[] = [];
		let env: Record<string, string> | undefined;
		const fetchImpl = createNamespaceDastFetch({
			namespaceOwnerId: "vwb-123e4567-e89b-12d3-a456-426614174000-owner",
			allowedOrigin: "http://127.0.0.1:18080",
			image: "http-executor@sha256:test",
			runner: { run: async (nextArgv, options) => { argv = nextArgv; env = options?.env; return { exitCode: 0, stdout: "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n\r\nok", stderr: "" }; } },
		});
		const response = await fetchImpl("http://127.0.0.1:18080/", { headers: { authorization: "Bearer secret" } });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
		expect(argv).toContain("container:vwb-123e4567-e89b-12d3-a456-426614174000-owner");
		expect(argv).toContain("1000:1000");
		expect(argv).toContain("--memory");
		expect(argv).toContain("--pids-limit");
		expect(argv.join(" ")).not.toContain("Bearer secret");
		expect(env?.VWB_HEADER_0).toContain("Bearer secret");
		const blocked = await fetchImpl("http://example.invalid/");
		expect(blocked.status).toBe(403);
		expect(argv).toContain("container:vwb-123e4567-e89b-12d3-a456-426614174000-owner");
	});
});
