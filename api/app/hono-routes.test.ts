import { describe, expect, it, vi } from "vitest";
import { readAppEnv } from "./env";
import { startRuntimeIsolationJanitorsIfConfigured } from "./hono-routes";

const digest = `sha256:${"d".repeat(64)}`;

function janitorRuntime() {
	const runtimeBundleStart = vi.fn();
	const dynamicBundleStart = vi.fn();
	return {
		runtime: {
			dbConnection: { db: {} as never },
			runtimeBundleLeaseJanitor: { start: runtimeBundleStart },
			dynamicBundleLeaseJanitor: { start: dynamicBundleStart },
		},
		runtimeBundleStart,
		dynamicBundleStart,
	};
}

describe("runtime isolation janitor activation", () => {
	it("starts both cleanup loops after a complete configuration is saved", async () => {
		const { runtime, runtimeBundleStart, dynamicBundleStart } = janitorRuntime();
		const env = readAppEnv({
			VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE: `owner@${digest}`,
			VULN_WORKBENCH_RUNTIME_NODE_IMAGE: `node@${digest}`,
			VULN_WORKBENCH_RUNTIME_MATERIALIZER_IMAGE: `materializer@${digest}`,
			VULN_WORKBENCH_RUNTIME_REGISTRY_PROXY_IMAGE: `proxy@${digest}`,
			VULN_WORKBENCH_RUNTIME_PROBE_IMAGE: `probe@${digest}`,
			VULN_WORKBENCH_RUNTIME_HTTP_EXECUTOR_IMAGE: `http@${digest}`,
			VULN_WORKBENCH_RUNTIME_DOCKER_DAEMON_IDENTITY_HASH: digest,
			VULN_WORKBENCH_RUNTIME_QUALIFICATION_HASH: digest,
		});

		await startRuntimeIsolationJanitorsIfConfigured(runtime, env);

		expect(runtimeBundleStart).toHaveBeenCalledOnce();
		expect(dynamicBundleStart).toHaveBeenCalledOnce();
	});

	it("does not start cleanup loops for an incomplete configuration", async () => {
		const { runtime, runtimeBundleStart, dynamicBundleStart } = janitorRuntime();

		await startRuntimeIsolationJanitorsIfConfigured(runtime, readAppEnv({}));

		expect(runtimeBundleStart).not.toHaveBeenCalled();
		expect(dynamicBundleStart).not.toHaveBeenCalled();
	});
});
