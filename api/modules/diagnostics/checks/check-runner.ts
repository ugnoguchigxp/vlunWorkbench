import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../../db";
import { findings, scanRuns, toolRuns } from "../../../db/schema";
import {
	AttackSurfaceRepository,
	SecurityCheckRepository,
} from "../repository";
import type { SecurityCheckResultInput } from "../types";
import { SECURITY_CHECK_DEFINITIONS } from "./check-registry";

export type SecurityCheckRunResult = {
	ok: boolean;
	projectId: string;
	scanRunId: string;
	resultCount: number;
	statusCounts: Record<string, number>;
	results: SecurityCheckResultInput[];
};

type InventoryItem = Awaited<
	ReturnType<AttackSurfaceRepository["listForScan"]>
>[number];

export class SecurityCheckRunner {
	private readonly attackSurfaceRepo: AttackSurfaceRepository;
	private readonly checkRepo: SecurityCheckRepository;

	constructor(private readonly db: AppDatabase) {
		this.attackSurfaceRepo = new AttackSurfaceRepository(db);
		this.checkRepo = new SecurityCheckRepository(db);
	}

	async run(params: {
		projectId: string;
		scanRunId: string;
		category?: string;
		checkId?: string;
		dryRun?: boolean;
	}): Promise<SecurityCheckRunResult> {
		const inventory = await this.attackSurfaceRepo.listForScan(
			params.projectId,
			params.scanRunId,
		);
		const scanRun = await this.db.query.scanRuns.findFirst({
			where: eq(scanRuns.id, params.scanRunId),
		});
		const toolRunRows = await this.db.query.toolRuns.findMany({
			where: eq(toolRuns.scanRunId, params.scanRunId),
		});
		const findingRows = await this.db.query.findings.findMany({
			where: eq(findings.scanRunId, params.scanRunId),
		});

		const definitions = SECURITY_CHECK_DEFINITIONS.filter((definition) => {
			if (params.category && definition.category !== params.category)
				return false;
			if (params.checkId && definition.checkId !== params.checkId) return false;
			return true;
		});
		const results = definitions.map((definition) =>
			evaluateCheck({
				projectId: params.projectId,
				scanRunId: params.scanRunId,
				definition,
				inventory,
				scanStatus: scanRun?.status ?? "unknown",
				toolCount: toolRunRows.length,
				findingCount: findingRows.length,
			}),
		);

		if (!params.dryRun) {
			await this.checkRepo.upsertDefinitions(SECURITY_CHECK_DEFINITIONS);
			await this.checkRepo.replaceResultsForScan({
				projectId: params.projectId,
				scanRunId: params.scanRunId,
				results,
				checkIds:
					params.category || params.checkId
						? definitions.map((definition) => definition.checkId)
						: undefined,
			});
		}

		return {
			ok: true,
			projectId: params.projectId,
			scanRunId: params.scanRunId,
			resultCount: results.length,
			statusCounts: countStatuses(results),
			results,
		};
	}
}

function evaluateCheck(params: {
	projectId: string;
	scanRunId: string;
	definition: (typeof SECURITY_CHECK_DEFINITIONS)[number];
	inventory: InventoryItem[];
	scanStatus: string;
	toolCount: number;
	findingCount: number;
}): SecurityCheckResultInput {
	const { definition, inventory } = params;
	const byCategory = (category: string) =>
		inventory.filter((item) => item.category === category);
	const byText = (needle: string) =>
		inventory.filter((item) =>
			`${item.name} ${JSON.stringify(item.locationJson)} ${JSON.stringify(
				item.boundaryJson,
			)}`
				.toLowerCase()
				.includes(needle.toLowerCase()),
		);
	const base = {
		projectId: params.projectId,
		scanRunId: params.scanRunId,
		checkId: definition.checkId,
		title: definition.title,
		evidenceRefs: [] as SecurityCheckResultInput["evidenceRefs"],
	};

	switch (definition.checkId) {
		case "auth.required_for_project_routes": {
			const protectedPrefixes = [
				"/api/projects",
				"/api/scans",
				"/api/scan-reports",
				"/api/findings",
				"/api/reproduction-runs",
				"/api/dynamic-runs",
				"/api/dast-runs",
			];
			const authItems = byText("requireAuth");
			const protectedCount = protectedPrefixes.filter((prefix) =>
				inventory.some(
					(item) =>
						item.category === "api_route" &&
						item.name.includes(prefix) &&
						authItems.some((authItem) =>
							JSON.stringify(authItem.locationJson).includes("api/app/hono.ts"),
						),
				),
			).length;
			if (protectedCount > 0) {
				return pass(
					base,
					`Authentication middleware is present for protected API route groups (${protectedCount} protected groups observed).`,
					authItems,
				);
			}
			return manualReview(
				base,
				"Could not confirm authentication middleware for project workflow routes from inventory.",
				"Review Hono middleware registration for project, scan, finding, and report routes.",
			);
		}
		case "auth.admin_routes_require_admin": {
			const adminItems = byText("requireAdmin");
			if (adminItems.length > 0) {
				return pass(
					base,
					"Admin guard usage was detected for admin route groups.",
					adminItems,
				);
			}
			return manualReview(
				base,
				"Admin route guard was not confirmed from inventory.",
				"Review admin routes and ensure requireAdmin is applied after authentication.",
			);
		}
		case "artifact.download_scoped_to_owner": {
			const artifactItems = byCategory("artifact_access");
			const ownershipSignals = byText("owner").concat(byText("Forbidden"));
			if (artifactItems.length > 0 && ownershipSignals.length > 0) {
				return pass(
					base,
					"Artifact access endpoints and ownership/forbidden checks were both observed.",
					artifactItems.slice(0, 5),
				);
			}
			return manualReview(
				base,
				"Artifact access exists, but ownership enforcement was not deterministically proven for every download path.",
				"Review artifact and diagnostic report download routes for scan project ownership checks.",
			);
		}
		case "path.repo_access_uses_scope_guard": {
			const guards = byCategory("file_path_boundary");
			if (guards.length > 0) {
				return pass(
					base,
					"Path normalization or scoped workspace guards were observed.",
					guards.slice(0, 5),
				);
			}
			return notChecked(
				base,
				"No path boundary inventory was available.",
				"Add or fix file path boundary extraction.",
			);
		}
		case "execution.no_shell_string_for_tool_runs": {
			const execution = byCategory("execution_boundary");
			const shellSignals = byText("shell");
			if (execution.length > 0 && shellSignals.length === 0) {
				return pass(
					base,
					"Execution boundaries were observed and no shell option signal was detected.",
					execution.slice(0, 5),
				);
			}
			if (execution.length > 0) {
				return manualReview(
					base,
					"Execution boundaries exist and shell-related text was observed; structured argument usage needs review.",
					"Confirm Bun.spawn and Docker invocations use argument arrays rather than shell strings.",
				);
			}
			return notChecked(
				base,
				"No execution boundary inventory was available.",
				"Add execution boundary extraction.",
			);
		}
		case "execution.runner_scrubs_sensitive_env": {
			const scrubSignals = byText("getCleanEnv").concat(byText("OPENAI"));
			if (scrubSignals.length > 0) {
				return pass(
					base,
					"Runner environment scrubbing logic was observed.",
					scrubSignals.slice(0, 5),
				);
			}
			return manualReview(
				base,
				"Sensitive environment scrubbing was not confirmed.",
				"Review scanner and Docker runner environment construction.",
			);
		}
		case "execution.docker_no_socket_mount": {
			const dockerSignals = byText("docker");
			const socketSignals = byText("docker.sock");
			if (dockerSignals.length > 0 && socketSignals.length === 0) {
				return pass(
					base,
					"Docker execution was observed with no Docker socket mount signal in inventory.",
					dockerSignals.slice(0, 5),
				);
			}
			if (socketSignals.length > 0) {
				return fail(
					base,
					"Docker socket mount text was observed and requires review.",
					socketSignals,
					"Remove Docker socket mounts from scanner and verification containers.",
				);
			}
			return notChecked(
				base,
				"No Docker execution inventory was available.",
				"Run attack surface inventory with execution boundary extraction.",
			);
		}
		case "config.production_jwt_secret_required": {
			const jwtSignals = byText("JWT_SECRET");
			if (jwtSignals.length > 0) {
				return pass(
					base,
					"JWT secret configuration handling was observed.",
					jwtSignals.slice(0, 5),
				);
			}
			return manualReview(
				base,
				"JWT production secret enforcement was not confirmed.",
				"Review runtime env parsing for production JWT secret validation.",
			);
		}
		case "config.cookie_security_reviewed": {
			const cookieSignals = byText("AUTH_COOKIE").concat(byText("sameSite"));
			if (cookieSignals.length > 0) {
				return pass(
					base,
					"Authentication cookie security settings were observed.",
					cookieSignals.slice(0, 5),
				);
			}
			return manualReview(
				base,
				"Authentication cookie security settings were not confirmed.",
				"Review auth cookie construction for httpOnly, SameSite, and Secure settings.",
			);
		}
		case "scan.zero_finding_has_coverage_context": {
			if (params.findingCount > 0) {
				return {
					...base,
					status: "not_applicable",
					outcome: "findings_present",
					summary:
						"The scan has normalized findings, so zero-finding coverage context is not applicable.",
				};
			}
			if (inventory.length > 0 && params.toolCount > 0) {
				return pass(
					base,
					`The zero-finding scan has ${inventory.length} inventory items and ${params.toolCount} tool runs available for coverage context.`,
					inventory.slice(0, 5),
				);
			}
			return notChecked(
				base,
				"Zero-finding scan lacks inventory or tool-run context.",
				"Run attack surface inventory and security checks before relying on the zero-finding report.",
			);
		}
		default:
			return notChecked(
				base,
				"No evaluator is implemented for this check.",
				"Implement a deterministic evaluator.",
			);
	}
}

function refsFromItems(
	items: InventoryItem[],
): SecurityCheckResultInput["evidenceRefs"] {
	return items.map((item) => {
		const location =
			item.locationJson && typeof item.locationJson === "object"
				? (item.locationJson as Record<string, unknown>)
				: {};
		return {
			kind: "diagnostic" as const,
			id: item.id,
			path: typeof location.path === "string" ? location.path : undefined,
			line: typeof location.line === "number" ? location.line : undefined,
			label: item.name,
		};
	});
}

function pass(
	base: Omit<SecurityCheckResultInput, "status" | "summary">,
	summary: string,
	items: InventoryItem[],
): SecurityCheckResultInput {
	return {
		...base,
		status: "pass",
		outcome: "confirmed",
		summary,
		evidenceRefs: refsFromItems(items),
	};
}

function fail(
	base: Omit<SecurityCheckResultInput, "status" | "summary">,
	summary: string,
	items: InventoryItem[],
	remediationHint: string,
): SecurityCheckResultInput {
	return {
		...base,
		status: "fail",
		outcome: "policy_violation",
		summary,
		evidenceRefs: refsFromItems(items),
		remediationHint,
	};
}

function manualReview(
	base: Omit<SecurityCheckResultInput, "status" | "summary">,
	summary: string,
	coverageGap: string,
): SecurityCheckResultInput {
	return {
		...base,
		status: "manual_review",
		outcome: "insufficient_evidence",
		summary,
		coverageGap,
	};
}

function notChecked(
	base: Omit<SecurityCheckResultInput, "status" | "summary">,
	summary: string,
	coverageGap: string,
): SecurityCheckResultInput {
	return {
		...base,
		status: "not_checked",
		outcome: "missing_input",
		summary,
		coverageGap,
	};
}

function countStatuses(
	results: SecurityCheckResultInput[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const result of results) {
		counts[result.status] = (counts[result.status] ?? 0) + 1;
	}
	return counts;
}
