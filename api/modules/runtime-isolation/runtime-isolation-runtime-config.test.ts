import { describe, expect, it } from "vitest";
import { loadRuntimeIsolationProviderFactory } from "./runtime-isolation-runtime-config";

const digest = `sha256:${"d".repeat(64)}`;

describe("runtime isolation runtime config", () => {
	it("fails closed unless every required image and qualification binding is digest-pinned", () => {
		expect(loadRuntimeIsolationProviderFactory({ db: {} as never, env: {} })).toBeNull();
		const env: Record<string, string> = {
			VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE: `owner@${digest}`,
			VULN_WORKBENCH_RUNTIME_NODE_IMAGE: `node@${digest}`,
			VULN_WORKBENCH_RUNTIME_MATERIALIZER_IMAGE: `materializer@${digest}`,
			VULN_WORKBENCH_RUNTIME_REGISTRY_PROXY_IMAGE: `proxy@${digest}`,
			VULN_WORKBENCH_RUNTIME_PROBE_IMAGE: `probe@${digest}`,
			VULN_WORKBENCH_RUNTIME_HTTP_EXECUTOR_IMAGE: `http@${digest}`,
			VULN_WORKBENCH_RUNTIME_DOCKER_DAEMON_IDENTITY_HASH: digest,
			VULN_WORKBENCH_RUNTIME_QUALIFICATION_HASH: digest,
		};
		expect(loadRuntimeIsolationProviderFactory({ db: {} as never, env })).toBeTypeOf("function");
	});
});
