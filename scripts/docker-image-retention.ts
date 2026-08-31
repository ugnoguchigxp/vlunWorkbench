const SCANNER_E2E_PINNED_REPOSITORY = "vuln-workbench-scanner-e2e-pinned";
const SCANNER_E2E_PINNED_TAG_PATTERN =
	/^vuln-workbench-scanner-e2e-pinned:[a-f0-9]{24}$/;
const PROJECT_SCANNER_IMAGE_TITLE_LABELS = [
	"org.opencontainers.image.title=vulnWorkbench toolbox",
	"org.opencontainers.image.title=vulnWorkbench optional Semgrep adapter image",
] as const;

type DockerCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type DockerImageRetentionCommand = (
	command: string[],
	env: Record<string, string>,
) => Promise<DockerCommandResult>;

export function scannerE2EPinnedTag(imageId: string): string {
	if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) {
		throw new Error(`scanner_e2e_toolbox_image_id_invalid:${imageId}`);
	}
	return `${SCANNER_E2E_PINNED_REPOSITORY}:${imageId.slice("sha256:".length, "sha256:".length + 24)}`;
}

export function staleScannerE2EPinnedTags(
	listOutput: string,
	keepTag: string,
): string[] {
	if (!SCANNER_E2E_PINNED_TAG_PATTERN.test(keepTag)) {
		throw new Error(`scanner_e2e_toolbox_keep_tag_invalid:${keepTag}`);
	}
	return [
		...new Set(
			listOutput
				.split("\n")
				.map((line) => line.trim())
				.filter((tag) => SCANNER_E2E_PINNED_TAG_PATTERN.test(tag)),
		),
	]
		.filter((tag) => tag !== keepTag)
		.sort();
}

export async function retainOnlyScannerE2EPinnedImage(params: {
	keepTag: string;
	env: Record<string, string>;
	command: DockerImageRetentionCommand;
}): Promise<void> {
	const listed = await params.command(
		[
			"docker",
			"image",
			"ls",
			"--filter",
			`reference=${SCANNER_E2E_PINNED_REPOSITORY}:*`,
			"--format",
			"{{.Repository}}:{{.Tag}}",
		],
		params.env,
	);
	if (listed.exitCode !== 0) {
		throw new Error(
			`scanner_e2e_toolbox_image_retention_list_failed:${listed.stderr}`,
		);
	}
	const staleTags = staleScannerE2EPinnedTags(listed.stdout, params.keepTag);
	if (staleTags.length > 0) {
		const removed = await params.command(
			["docker", "image", "rm", ...staleTags],
			params.env,
		);
		if (removed.exitCode !== 0) {
			throw new Error(
				`scanner_e2e_toolbox_image_retention_cleanup_failed:${removed.stderr}`,
			);
		}
	}
	for (const label of PROJECT_SCANNER_IMAGE_TITLE_LABELS) {
		const pruned = await params.command(
			[
				"docker",
				"image",
				"prune",
				"--force",
				"--filter",
				"dangling=true",
				"--filter",
				`label=${label}`,
			],
			params.env,
		);
		if (pruned.exitCode !== 0) {
			throw new Error(
				`scanner_e2e_toolbox_image_retention_prune_failed:${pruned.stderr}`,
			);
		}
	}
}
