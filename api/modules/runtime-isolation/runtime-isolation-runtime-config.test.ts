import { describe, expect, it } from "vitest";
import {
	loadRuntimeIsolationProviderFactory,
	runtimeIsolationSettingsFromAppEnv,
} from "./runtime-isolation-runtime-config";

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

	it("loads the provider from SQLite-backed runtime settings without environment variables", () => {
		expect(
			loadRuntimeIsolationProviderFactory({
				db: {} as never,
				env: {},
				settings: {
					namespaceOwnerImage: `owner@${digest}`,
					nodeImage: `node@${digest}`,
					materializerImage: `materializer@${digest}`,
					registryProxyImage: `proxy@${digest}`,
					probeImage: `probe@${digest}`,
					httpExecutorImage: `http@${digest}`,
					dockerDaemonIdentityHash: digest,
					qualificationHash: digest,
					postgresImage: "",
					mysqlImage: "",
					nucleiImage: "",
					zapImage: "",
					schemathesisImage: "",
				},
			}),
		).toBeTypeOf("function");
	});

	it("fails closed for mutable images stored in runtime settings", () => {
		expect(
			loadRuntimeIsolationProviderFactory({
				db: {} as never,
				settings: {
					namespaceOwnerImage: "owner:latest",
					nodeImage: "",
					materializerImage: "",
					registryProxyImage: "",
					probeImage: "",
					httpExecutorImage: "",
					dockerDaemonIdentityHash: "",
					qualificationHash: "",
					postgresImage: "",
					mysqlImage: "",
					nucleiImage: "",
					zapImage: "",
					schemathesisImage: "",
				},
			}),
		).toBeNull();
	});

	it("normalizes an invalid legacy AppEnv bootstrap to unavailable defaults", () => {
		const settings = runtimeIsolationSettingsFromAppEnv({
			runtimeIsolation: {
				namespaceOwnerImage: "owner:latest",
				nodeImage: `node@${digest}`,
				materializerImage: "",
				registryProxyImage: "",
				probeImage: "",
				httpExecutorImage: "",
				dockerDaemonIdentityHash: "",
				qualificationHash: "",
				postgresImage: "",
				mysqlImage: "",
				nucleiImage: "",
				zapImage: "",
				schemathesisImage: "",
			},
		});

		expect(settings).toMatchObject({
			namespaceOwnerImage: "",
			nodeImage: `node@${digest}`,
			dockerDaemonIdentityHash: "",
		});
	});
});
