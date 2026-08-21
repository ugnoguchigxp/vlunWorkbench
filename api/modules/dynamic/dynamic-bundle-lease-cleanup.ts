import { dynamicOutputVolumeName } from "./dynamic-docker-executor";

type DockerRunner = {
	run(argv: string[]): Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
	}>;
};

type DynamicLease = {
	provider: string;
	resourceType: string;
	receipt: Record<string, unknown>;
};

function wasAlreadyRemoved(
	result: {
		exitCode: number | null;
		stderr: string;
	},
	resource: "container" | "volume",
): boolean {
	return (
		result.exitCode === 0 ||
		new RegExp(`No such ${resource}`, "i").test(result.stderr)
	);
}

/** Reclaims only receipts emitted by the Dynamic Bundle executor. */
export async function cleanupExpiredDynamicBundle(params: {
	lease: DynamicLease;
	runner: DockerRunner;
	dockerBin?: string;
}): Promise<void> {
	if (
		params.lease.provider !== "docker-dynamic-isolation" ||
		params.lease.resourceType !== "dynamic_bundle"
	) {
		throw new Error("dynamic_bundle_lease_rejected");
	}
	const { containerName, outputVolumeName } = params.lease.receipt;
	if (
		typeof containerName !== "string" ||
		typeof outputVolumeName !== "string" ||
		dynamicOutputVolumeName(containerName) !== outputVolumeName
	) {
		throw new Error("dynamic_bundle_receipt_invalid");
	}
	const dockerBin = params.dockerBin ?? "docker";
	for (const [resource, argv] of [
		["container", [dockerBin, "rm", "-f", containerName]],
		["volume", [dockerBin, "volume", "rm", "-f", outputVolumeName]],
	] as const) {
		const result = await params.runner.run([...argv]);
		if (!wasAlreadyRemoved(result, resource)) {
			throw new Error("dynamic_bundle_cleanup_failed");
		}
	}
}
