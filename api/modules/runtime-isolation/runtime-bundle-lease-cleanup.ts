import {
	cleanupRuntimeBundle,
	type DockerCommandRunner,
	type PrivateRuntimeBundleReceipt,
} from "./docker-runtime-bundle";

/** Reaper adapter: accepts only the private receipt shape written by a bundle. */
export async function cleanupExpiredRuntimeBundle(params: {
	dockerBin?: string;
	runner: DockerCommandRunner;
	lease: {
		provider: string;
		resourceType: string;
		receipt: Record<string, unknown>;
	};
}): Promise<void> {
	if (
		params.lease.provider !== "docker-runtime-isolation" ||
		params.lease.resourceType !== "runtime_bundle"
	) {
		return;
	}
	const receipt = parseReceipt(params.lease.receipt);
	await cleanupRuntimeBundle({
		dockerBin: params.dockerBin ?? "docker",
		receipt,
		runner: params.runner,
	});
}

function parseReceipt(
	value: Record<string, unknown>,
): PrivateRuntimeBundleReceipt {
	if (
		typeof value.bundleId !== "string" ||
		typeof value.scanRunId !== "string" ||
		!Array.isArray(value.children)
	) {
		throw new Error("runtime_bundle_receipt_invalid");
	}
	const children = value.children.map((child) => {
		if (
			!child ||
			typeof child !== "object" ||
			typeof (child as Record<string, unknown>).id !== "string" ||
			!(["container", "volume", "network"] as string[]).includes(
				(child as Record<string, unknown>).kind as string,
			)
		) {
			throw new Error("runtime_bundle_receipt_invalid");
		}
		return child as PrivateRuntimeBundleReceipt["children"][number];
	});
	return { bundleId: value.bundleId, scanRunId: value.scanRunId, children };
}
