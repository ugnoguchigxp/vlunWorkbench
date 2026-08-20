import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export const TODOLIST_ACCEPTANCE_PROFILES = [
	{
		id: "gitleaks",
		profile: "baseline",
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
		id: "trivy-fs",
		profile: "secrets-dependencies-runtime",
		step: "trivy",
		requiresTarget: false,
		expectedArtifactKinds: ["raw_result"],
	},
	{
		id: "sbom",
		profile: "sbom-inventory",
		step: null,
		requiresTarget: false,
		expectedArtifactKinds: ["sbom"],
	},
	{
		id: "schemathesis-no-schema",
		profile: "api-schema-readonly",
		step: null,
		requiresTarget: false,
		expectedArtifactKinds: [],
		expectedNotApplicableReason: "schema_not_found",
	},
	{
		id: "nuclei-safe",
		profile: "runtime-web-safe",
		step: null,
		requiresTarget: true,
		expectedArtifactKinds: ["raw_result"],
	},
	{
		id: "zap-baseline",
		profile: "runtime-zap-baseline",
		step: null,
		requiresTarget: true,
		expectedArtifactKinds: ["raw_result"],
	},
	{
		id: "trivy-image",
		profile: "container-image-security",
		step: null,
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

export async function resolveTodolistAcceptanceTarget(
	repoPath = path.resolve(process.cwd(), "..", "todolist"),
): Promise<TodolistAcceptanceTarget> {
	const resolved = path.resolve(repoPath);
	const [packageJson, dockerfile] = await Promise.all([
		fs.access(path.join(resolved, "package.json")),
		fs.access(path.join(resolved, "Dockerfile")),
	]);
	void packageJson;
	void dockerfile;
	let commit: string;
	try {
		commit = execFileSync("git", ["-C", resolved, "rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim();
	} catch {
		throw new Error("todolist_acceptance_target_not_a_git_repository");
	}
	return {
		repoPath: resolved,
		commit,
		dockerfilePath: path.join(resolved, "Dockerfile"),
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
