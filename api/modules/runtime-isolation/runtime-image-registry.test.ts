import { describe, expect, it } from "vitest";
import { loadRuntimeImageRegistry, runtimePlanImages } from "./runtime-image-registry";

const ref = (name: string, letter: string) => `${name}@sha256:${letter.repeat(64)}`;

describe("runtime image registry", () => {
	it("requires digest-pinned images and exposes only digests to plans", () => {
		const registry = loadRuntimeImageRegistry({
			VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE: ref("owner", "a"),
			VULN_WORKBENCH_RUNTIME_NODE_IMAGE: ref("node", "b"),
			VULN_WORKBENCH_RUNTIME_MATERIALIZER_IMAGE: ref("materializer", "c"),
			VULN_WORKBENCH_RUNTIME_REGISTRY_PROXY_IMAGE: ref("proxy", "d"),
			VULN_WORKBENCH_RUNTIME_PROBE_IMAGE: ref("probe", "e"),
			VULN_WORKBENCH_RUNTIME_HTTP_EXECUTOR_IMAGE: ref("executor", "f"),
			VULN_WORKBENCH_RUNTIME_POSTGRES_IMAGE: ref("postgres", "0"),
		});
		expect(registry).not.toBeNull();
		expect(runtimePlanImages(registry!).nodeRuntimeImageDigest).toBe(`sha256:${"b".repeat(64)}`);
		expect(runtimePlanImages(registry!).databaseImageDigests.postgres_ephemeral).toBe(`sha256:${"0".repeat(64)}`);
	});

	it("fails closed for a mutable image", () => {
		expect(loadRuntimeImageRegistry({
			VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE: "owner:latest",
			VULN_WORKBENCH_RUNTIME_NODE_IMAGE: ref("node", "b"),
			VULN_WORKBENCH_RUNTIME_MATERIALIZER_IMAGE: ref("materializer", "c"),
			VULN_WORKBENCH_RUNTIME_REGISTRY_PROXY_IMAGE: ref("proxy", "d"),
			VULN_WORKBENCH_RUNTIME_PROBE_IMAGE: ref("probe", "e"),
			VULN_WORKBENCH_RUNTIME_HTTP_EXECUTOR_IMAGE: ref("executor", "f"),
		})).toBeNull();
	});

	it("accepts a bare local image ID as an immutable Docker reference", () => {
		const localImageId = `sha256:${"a".repeat(64)}`;
		const registry = loadRuntimeImageRegistry({
			VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE: localImageId,
			VULN_WORKBENCH_RUNTIME_NODE_IMAGE: localImageId,
			VULN_WORKBENCH_RUNTIME_MATERIALIZER_IMAGE: localImageId,
			VULN_WORKBENCH_RUNTIME_REGISTRY_PROXY_IMAGE: localImageId,
			VULN_WORKBENCH_RUNTIME_PROBE_IMAGE: localImageId,
			VULN_WORKBENCH_RUNTIME_HTTP_EXECUTOR_IMAGE: localImageId,
		});

		expect(registry).toMatchObject({ nodeRuntime: localImageId });
		expect(runtimePlanImages(registry!).nodeRuntimeImageDigest).toBe(
			localImageId,
		);
	});

	it("rejects digest-looking values that are not a single image reference", () => {
		expect(
			loadRuntimeImageRegistry({
				VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE: `${ref("owner", "a")}\n${ref("other", "a")}`,
				VULN_WORKBENCH_RUNTIME_NODE_IMAGE: ref("node", "b"),
				VULN_WORKBENCH_RUNTIME_MATERIALIZER_IMAGE: ref("materializer", "c"),
				VULN_WORKBENCH_RUNTIME_REGISTRY_PROXY_IMAGE: ref("proxy", "d"),
				VULN_WORKBENCH_RUNTIME_PROBE_IMAGE: ref("probe", "e"),
				VULN_WORKBENCH_RUNTIME_HTTP_EXECUTOR_IMAGE: ref("executor", "f"),
			}),
		).toBeNull();
	});
});
