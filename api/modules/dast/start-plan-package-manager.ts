import type { DastStartPlanV1 } from "../project-capabilities/plugin-contract";

export type DastPackageManager =
	| "bun"
	| "pnpm"
	| "yarn"
	| "npm"
	| "maven"
	| "gradle"
	| "python";

export function packageManagerForStartPlan(
	plan: DastStartPlanV1,
): DastPackageManager {
	if (plan.executable === "./mvnw" || plan.executable === "mvn") return "maven";
	if (plan.executable === "./gradlew" || plan.executable === "gradle") {
		return "gradle";
	}
	if (plan.executable === "python3") return "python";
	if (
		plan.executable === "bun" ||
		plan.executable === "pnpm" ||
		plan.executable === "yarn" ||
		plan.executable === "npm"
	) {
		return plan.executable;
	}
	throw new Error("dast_start_executable_not_allowed");
}
