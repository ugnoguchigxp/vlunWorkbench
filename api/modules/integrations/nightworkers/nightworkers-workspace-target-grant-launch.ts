export function asWorkspaceGrantRecord(
	value: unknown,
): Record<string, unknown> {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

export function isWorkspaceGrantScanStatus(
	value: string,
): value is "queued" | "running" | "completed" | "failed" | "cancelled" {
	return (
		value === "queued" ||
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "cancelled"
	);
}

export function workspaceGrantScanArgs(params: {
	scanRunId: string;
	projectId: string;
	grantRef: string;
	profileRef: string;
	targetDigest: string;
	runner: "host" | "docker";
}): string[] {
	return [
		"bun",
		"run",
		"api/cli/scan-profile.ts",
		"--scan-run-id",
		params.scanRunId,
		"--execution-surface",
		"web",
		"--project-id",
		params.projectId,
		"--workspace-target-grant-ref",
		params.grantRef,
		"--profile",
		params.profileRef,
		"--continue-on-tool-failure",
		"true",
		"--runner",
		params.runner,
		"--final-report",
		"false",
		"--target",
		"working-tree",
		"--include-untracked",
		"true",
		"--expected-target-digest",
		params.targetDigest,
	];
}
