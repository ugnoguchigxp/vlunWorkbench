import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const TODOLIST_ACCEPTANCE_PROFILES = [
	{
		id: "gitleaks",
		profile: "full-security-scan",
		step: "gitleaks",
		requiresTarget: false,
		expectedArtifactKinds: ["raw_result"],
	},
	{
		id: "osv",
		profile: "baseline",
		step: "osv",
		requiresTarget: false,
		expectedArtifactKinds: ["raw_result"],
	},
	{
		id: "osv-installed-tree",
		profile: "full-security-scan",
		step: "osv",
		requiresTarget: false,
		expectedArtifactKinds: ["raw_result"],
	},
	{
		id: "trivy-fs",
		profile: "full-security-scan",
		step: "trivy",
		requiresTarget: false,
		expectedArtifactKinds: ["raw_result"],
	},
	{
		id: "semgrep",
		profile: "full-security-scan",
		step: "semgrep",
		requiresTarget: false,
		expectedArtifactKinds: ["raw_result"],
	},
	{
		id: "zizmor",
		profile: "full-security-scan",
		step: "zizmor",
		requiresTarget: false,
		expectedArtifactKinds: ["raw_result"],
	},
	{
		id: "sbom",
		profile: "sbom-inventory",
		step: "sbom_export:trivy",
		requiresTarget: false,
		expectedArtifactKinds: ["sbom"],
	},
	{
		id: "schemathesis-no-schema",
		profile: "api-schema-readonly",
		step: "api_schema_scan:schemathesis",
		requiresTarget: false,
		expectedArtifactKinds: [],
		expectedNotApplicableReason: "schema_not_found",
		expectedProfileOutcome: "completed",
	},
	{
		id: "schemathesis-readonly",
		profile: "api-schema-readonly",
		step: "api_schema_scan:schemathesis",
		requiresTarget: true,
		expectedArtifactKinds: ["raw_result"],
	},
	{
		id: "passive-dast",
		profile: "runtime-web-safe",
		step: "dast:web-passive-standard",
		requiresTarget: true,
		expectedArtifactKinds: ["dast_raw_result"],
	},
	{
		id: "nuclei-safe",
		profile: "runtime-web-safe",
		step: "runtime_scanner:nuclei-safe",
		requiresTarget: true,
		expectedArtifactKinds: ["raw_result"],
	},
	{
		id: "zap-baseline",
		profile: "runtime-web-safe",
		step: "runtime_scanner:zap-baseline",
		requiresTarget: true,
		expectedArtifactKinds: ["raw_result"],
	},
	{
		id: "trivy-image",
		profile: "container-image-security",
		step: "container_image_scan:trivy",
		requiresTarget: true,
		expectedArtifactKinds: ["raw_result"],
	},
] as const;

export type TodolistAcceptanceProfile =
	(typeof TODOLIST_ACCEPTANCE_PROFILES)[number];

export type TodolistAcceptanceTarget = {
	repoPath: string;
	commit: string;
	dockerfilePath: string;
};

type TodolistTargetContract = {
	schemaVersion: number;
	repository: "todolist";
	commit: string;
};

export type TodolistSourceSnapshot = {
	sourcePath: string;
	archivePath: string;
	archiveSha256: string;
};

function targetContractPath() {
	return path.resolve(
		import.meta.dir,
		"../spec/security-capability/todolist-scan-target.v1.json",
	);
}

async function loadTargetContract(
	contractPath = targetContractPath(),
): Promise<TodolistTargetContract> {
	const parsed: unknown = JSON.parse(await fs.readFile(contractPath, "utf8"));
	if (
		!parsed ||
		typeof parsed !== "object" ||
		(parsed as Record<string, unknown>).schemaVersion !== 1 ||
		(parsed as Record<string, unknown>).repository !== "todolist" ||
		typeof (parsed as Record<string, unknown>).commit !== "string" ||
		!/^[a-f0-9]{40}$/.test((parsed as Record<string, unknown>).commit as string)
	) {
		throw new Error("todolist_acceptance_target_contract_invalid");
	}
	return parsed as TodolistTargetContract;
}

function runGit(repoPath: string, args: string[]): string {
	try {
		return execFileSync("git", ["-C", repoPath, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch {
		throw new Error("todolist_acceptance_target_not_a_git_repository");
	}
}

export async function resolveTodolistAcceptanceTarget(
	repoPath = process.env.VULN_WORKBENCH_TODOLIST_REPO_PATH ??
		path.resolve(process.cwd(), "..", "todolist"),
	options: { contractPath?: string } = {},
): Promise<TodolistAcceptanceTarget> {
	const resolved = path.resolve(repoPath);
	if (path.basename(resolved) !== "todolist") {
		throw new Error("todolist_acceptance_target_identity_mismatch");
	}
	const [packageJson, dockerfile] = await Promise.all([
		fs.access(path.join(resolved, "package.json")),
		fs.access(path.join(resolved, "Dockerfile")),
	]);
	void packageJson;
	void dockerfile;
	const contract = await loadTargetContract(options.contractPath);
	const status = runGit(resolved, [
		"status",
		"--porcelain=v1",
		"--untracked-files=all",
	]);
	if (status) throw new Error("todolist_acceptance_target_dirty");
	try {
		runGit(resolved, ["cat-file", "-e", `${contract.commit}^{commit}`]);
	} catch {
		throw new Error("todolist_acceptance_target_commit_unavailable");
	}
	return {
		repoPath: resolved,
		commit: contract.commit,
		dockerfilePath: path.join(resolved, "Dockerfile"),
	};
}

async function run(command: string[]): Promise<void> {
	const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
	const [exitCode, stderr] = await Promise.all([
		child.exited,
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0)
		throw new Error(`todolist_acceptance_snapshot_failed:${stderr}`);
}

/** Creates an immutable input for every scanner invocation. */
export async function createTodolistSourceSnapshot(
	target: TodolistAcceptanceTarget,
	runRoot: string,
): Promise<TodolistSourceSnapshot> {
	const archivePath = path.join(runRoot, "todolist-source.tar");
	const sourcePath = path.join(runRoot, "target-runtime", "source");
	// A tar archive alone has no .git directory, which makes a strict scan
	// unable to bind its source revision. Clone at the reviewed commit so every
	// scanner sees an isolated, clean, immutable Git worktree as well as the
	// archive digest retained for evidence.
	await run([
		"git",
		"clone",
		"--no-local",
		"--no-checkout",
		target.repoPath,
		sourcePath,
	]);
	await run(["git", "-C", sourcePath, "checkout", "--detach", target.commit]);
	await run([
		"git",
		"-C",
		target.repoPath,
		"archive",
		"--format=tar",
		"--output",
		archivePath,
		target.commit,
	]);
	const archiveSha256 = crypto
		.createHash("sha256")
		.update(await fs.readFile(archivePath))
		.digest("hex");
	return {
		sourcePath: await fs.realpath(sourcePath),
		archivePath,
		archiveSha256,
	};
}

export function selectTodolistAcceptanceProfiles(
	ids: readonly string[],
): TodolistAcceptanceProfile[] {
	if (ids.length === 0) return [...TODOLIST_ACCEPTANCE_PROFILES];
	const selected = TODOLIST_ACCEPTANCE_PROFILES.filter((profile) =>
		ids.includes(profile.id),
	);
	if (selected.length !== ids.length) {
		const known = new Set<string>(selected.map((profile) => profile.id));
		const unknown = ids.filter((id) => !known.has(id));
		throw new Error(`todolist_acceptance_profile_unknown:${unknown.join(",")}`);
	}
	return selected;
}
