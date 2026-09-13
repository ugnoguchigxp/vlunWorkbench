import crypto from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { DastFetch } from "../../api/modules/dast/http-runner";
import { detectSecurityProbe } from "../../api/modules/dast/security-probe-detector";
import {
	type ContainerFixtureResetExecutor,
	createContainerFixtureLoopbackFetch,
	createContainerFixtureResetExecutor,
	listContainerFixtures,
} from "../../api/modules/runtime-scans/container-fixture-reset";
import type { ActiveResetExecutor } from "../../api/modules/runtime-scans/zap-active-runner";
import { executeJuiceShopFixedControl } from "../../tests/security-capability/juice-shop/fixed-app";
import {
	responseShapeHash,
	writeJuiceShopExecutionEvidence,
} from "./juice-shop-evidence";
import {
	type JuiceShopObservation,
	juiceShopObservationSchema,
} from "./juice-shop-observations";
import type {
	JuiceShopCatalog,
	JuiceShopPlaybook,
} from "./juice-shop-playbooks";
import {
	BoundedJuiceShopClient,
	executeVulnerableProbe,
	type ProbeExecution,
} from "./juice-shop-probes";

const TARGET_ORIGIN = "http://127.0.0.1:3000";
const _MAX_RESPONSE_BYTES = 1024 * 1024;
const FIXTURE_ID = "juice-shop-20.1.1";

export type JuiceShopRunnerResult = {
	observations: JuiceShopObservation[];
	preflight: {
		status: "passed" | "blocked";
		platform: string;
		fixtureId: string;
		image: string;
		targetOrigin: string;
		authoritativeLinux: boolean;
		errorCode: string | null;
	};
};

export async function runJuiceShopScenarios(params: {
	catalog: JuiceShopCatalog;
	playbooks: JuiceShopPlaybook[];
	evidenceRoot: string;
	targetOrigin?: string;
	resetExecutor?: ActiveResetExecutor;
	executeProbe?: (
		playbook: JuiceShopPlaybook,
		cwe: string,
		client: BoundedJuiceShopClient,
	) => Promise<ProbeExecution>;
	fetchImpl?: DastFetch;
}): Promise<JuiceShopRunnerResult> {
	const targetOrigin = params.targetOrigin ?? TARGET_ORIGIN;
	assertLocalTarget(targetOrigin);
	const fixture = listContainerFixtures().find(
		(item) => item.fixtureId === FIXTURE_ID,
	);
	if (!fixture) throw new Error("juice_shop_fixture_not_registered");
	const resetStrategy = {
		kind: "container_recreate" as const,
		fixtureId: FIXTURE_ID,
		expectedBaselineHash: fixture.expectedBaselineHash,
	};
	const defaultResetExecutor: ContainerFixtureResetExecutor | null =
		params.resetExecutor
			? null
			: createContainerFixtureResetExecutor({
					strategy: resetStrategy,
					targetOrigin,
					fetchImpl: createContainerFixtureLoopbackFetch({
						fixtureId: FIXTURE_ID,
					}),
				});
	const resetExecutor = params.resetExecutor ?? defaultResetExecutor;
	if (!resetExecutor) throw new Error("juice_shop_reset_executor_missing");
	const targetFetch =
		params.fetchImpl ??
		(params.resetExecutor
			? fetch
			: createContainerFixtureLoopbackFetch({ fixtureId: FIXTURE_ID }));
	const lockPath = path.resolve(".artifacts/benchmark/juice-shop.lock");
	let lockError: string | null = null;
	const releaseLock = await acquireLock(lockPath).catch((error) => {
		lockError = safeErrorCode(error);
		return null;
	});
	if (!releaseLock) {
		const errorCode = lockError ?? "juice_shop_lock_unavailable";
		return {
			observations: blockedObservations(params.playbooks, errorCode),
			preflight: {
				status: "blocked",
				platform: process.platform,
				fixtureId: FIXTURE_ID,
				image: fixture.image,
				targetOrigin,
				authoritativeLinux: process.platform === "linux",
				errorCode,
			},
		};
	}
	const observations: JuiceShopObservation[] = [];
	const scenarioById = new Map(
		params.catalog.scenarios.map((scenario) => [scenario.id, scenario]),
	);
	let preflightError: string | null = null;
	let teardownAttempted = false;
	const teardownDefaultFixture = async () => {
		if (!defaultResetExecutor || teardownAttempted) return;
		teardownAttempted = true;
		const teardown = await defaultResetExecutor.teardown();
		if (!teardown.ok)
			preflightError ??=
				teardown.errorCode ?? "juice_shop_fixture_teardown_failed";
	};
	try {
		for (const playbook of params.playbooks) {
			const scenario = scenarioById.get(playbook.scenarioId);
			if (!scenario)
				throw new Error(
					`juice_shop_runner_scenario_missing:${playbook.scenarioId}`,
				);
			let prepareBaselineHash: string | null = null;
			let cleanupBaselineHash: string | null = null;
			let cleanupSucceeded = false;
			let vulnerable: ProbeExecution | null = null;
			let fixed: ReturnType<typeof executeJuiceShopFixedControl> | null = null;
			let cleanupError: string | undefined;
			try {
				prepareBaselineHash = (await resetExecutor.prepare(resetStrategy))
					.baselineHash;
				const client = new BoundedJuiceShopClient({
					origin: targetOrigin,
					playbook,
					fetchImpl: targetFetch,
				});
				vulnerable = await (params.executeProbe ?? executeVulnerableProbe)(
					playbook,
					scenario.cwe[0] ?? "CWE-20",
					client,
				);
				fixed = executeJuiceShopFixedControl({
					playbook,
					cwe: scenario.cwe[0] ?? "CWE-20",
				});
				const cleanup = await resetExecutor.reset(resetStrategy);
				cleanupSucceeded =
					cleanup.ok &&
					cleanup.baselineHash !== null &&
					cleanup.baselineHash === prepareBaselineHash;
				cleanupBaselineHash = cleanup.baselineHash;
				cleanupError = cleanup.errorCode;
				const vulnerableEvidence = await writeJuiceShopExecutionEvidence({
					evidenceRoot: params.evidenceRoot,
					scenarioId: playbook.scenarioId,
					targetKind: "vulnerable",
					controlId: playbook.controlId,
					probe: vulnerable.probe,
					findings: vulnerable.findings,
					requests: vulnerable.requests,
				});
				const fixedFindings = detectSecurityProbe(fixed.probe, {
					scenarioId: playbook.scenarioId,
					targetKind: "fixed",
				});
				const fixedEvidence = await writeJuiceShopExecutionEvidence({
					evidenceRoot: params.evidenceRoot,
					scenarioId: playbook.scenarioId,
					targetKind: "fixed",
					controlId: fixed.controlId,
					probe: fixed.probe,
					findings: fixedFindings,
					requests: [
						{
							method: fixed.request.method,
							path: fixed.request.path,
							queryKeys: [],
							status: fixed.request.status,
							responseBytes: 0,
							responseShapeHash: responseShapeHash(fixed.probe),
						},
					],
				});
				const scenarioStatus = !cleanupSucceeded
					? "failed_cleanup"
					: vulnerable.status === "completed"
						? "completed"
						: "inconclusive";
				observations.push(
					juiceShopObservationSchema.parse({
						schemaVersion: 2,
						scenarioId: playbook.scenarioId,
						runnerFamily: playbook.runnerFamily,
						scenarioStatus,
						vulnerable: {
							executionStatus:
								vulnerable.status === "completed"
									? "completed"
									: "inconclusive",
							detection:
								vulnerable.status !== "completed"
									? "not_scored"
									: vulnerable.findings.length > 0
										? "detected"
										: "not_detected",
							evidencePath: vulnerableEvidence.evidencePath,
							evidenceHash: vulnerableEvidence.evidenceHash,
							normalizedFindingRefs: vulnerable.findings.map(
								(finding) => finding.id,
							),
						},
						fixed: {
							executionStatus: "completed",
							detection: fixedFindings.length > 0 ? "detected" : "not_detected",
							evidencePath: fixedEvidence.evidencePath,
							evidenceHash: fixedEvidence.evidenceHash,
							normalizedFindingRefs: fixedFindings.map((finding) => finding.id),
						},
						lifecycle: {
							targetRequestCount: vulnerable.requests.length + 1,
							externalNetworkRequests: 0,
							publicProductionRequests: 0,
							prepareBaselineHash,
							cleanupBaselineHash,
							cleanupSucceeded,
							credentialCanaryLeakage: false,
						},
						limitationCodes: [
							...(vulnerable.errorCode ? [vulnerable.errorCode] : []),
							...(cleanupError ? [cleanupError] : []),
						],
					}),
				);
				if (!cleanupSucceeded) break;
			} catch (error) {
				const errorCode = safeErrorCode(error);
				preflightError ??= observations.length === 0 ? errorCode : null;
				if (prepareBaselineHash !== null && !cleanupSucceeded) {
					const cleanup = await resetExecutor
						.reset(resetStrategy)
						.catch(() => ({
							ok: false,
							baselineHash: null,
							errorCode: "cleanup_after_error_failed",
						}));
					cleanupSucceeded =
						cleanup.ok &&
						cleanup.baselineHash !== null &&
						cleanup.baselineHash === prepareBaselineHash;
					cleanupBaselineHash = cleanup.baselineHash;
				}
				observations.push(
					blockedObservation(
						playbook,
						prepareBaselineHash === null
							? "blocked"
							: cleanupSucceeded
								? "inconclusive"
								: "failed_cleanup",
						errorCode,
						prepareBaselineHash,
						cleanupBaselineHash,
						cleanupSucceeded,
					),
				);
				if (!cleanupSucceeded || prepareBaselineHash === null) break;
			}
		}
		if (observations.length < params.playbooks.length) {
			const completedIds = new Set(
				observations.map((observation) => observation.scenarioId),
			);
			for (const playbook of params.playbooks) {
				if (!completedIds.has(playbook.scenarioId)) {
					observations.push(
						blockedObservation(
							playbook,
							"blocked",
							"prior_scenario_cleanup_or_preflight_failed",
							null,
							null,
							false,
						),
					);
				}
			}
		}
		await teardownDefaultFixture();
		return {
			observations,
			preflight: {
				status: preflightError ? "blocked" : "passed",
				platform: process.platform,
				fixtureId: FIXTURE_ID,
				image: fixture.image,
				targetOrigin,
				authoritativeLinux: process.platform === "linux",
				errorCode: preflightError,
			},
		};
	} finally {
		await teardownDefaultFixture();
		await releaseLock();
	}
}

function blockedObservations(
	playbooks: JuiceShopPlaybook[],
	errorCode: string,
): JuiceShopObservation[] {
	return playbooks.map((playbook) =>
		blockedObservation(playbook, "blocked", errorCode, null, null, false),
	);
}

function blockedObservation(
	playbook: JuiceShopPlaybook,
	status: "blocked" | "inconclusive" | "failed_cleanup",
	errorCode: string,
	prepareBaselineHash: string | null,
	cleanupBaselineHash: string | null,
	cleanupSucceeded: boolean,
): JuiceShopObservation {
	const executionStatus =
		status === "blocked"
			? "blocked"
			: status === "failed_cleanup"
				? "failed"
				: "inconclusive";
	return juiceShopObservationSchema.parse({
		schemaVersion: 2,
		scenarioId: playbook.scenarioId,
		runnerFamily: playbook.runnerFamily,
		scenarioStatus: status,
		vulnerable: {
			executionStatus,
			detection: "not_scored",
			evidencePath: null,
			evidenceHash: null,
			normalizedFindingRefs: [],
		},
		fixed: {
			executionStatus: "blocked",
			detection: "not_scored",
			evidencePath: null,
			evidenceHash: null,
			normalizedFindingRefs: [],
		},
		lifecycle: {
			targetRequestCount: 0,
			externalNetworkRequests: 0,
			publicProductionRequests: 0,
			prepareBaselineHash,
			cleanupBaselineHash,
			cleanupSucceeded,
			credentialCanaryLeakage: false,
		},
		limitationCodes: [errorCode],
	});
}

export function assertLocalTarget(origin: string): void {
	const url = new URL(origin);
	if (
		url.protocol !== "http:" ||
		!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
		url.port !== "3000"
	) {
		throw new Error("juice_shop_local_target_required");
	}
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
	await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
	const token = crypto.randomUUID();
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			handle = await open(lockPath, "wx", 0o600);
			await handle.writeFile(
				`${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })}\n`,
			);
			break;
		} catch (error) {
			if (!isNodeError(error, "EEXIST")) throw error;
			if (attempt > 0 || !(await isStaleLock(lockPath)))
				throw new Error("shared_fixture_busy");
			const before = await readFile(lockPath, "utf8").catch(() => null);
			if (before === null || !(await isStaleLock(lockPath))) throw error;
			const current = await readFile(lockPath, "utf8").catch(() => null);
			if (current !== before) throw error;
			await rm(lockPath, { force: true });
		}
	}
	if (!handle) throw new Error("juice_shop_lock_unavailable");
	return async () => {
		await handle?.close();
		const current = await readFile(lockPath, "utf8").catch(() => "");
		if (current.includes(`"token":"${token}"`))
			await rm(lockPath, { force: true });
	};
}

async function isStaleLock(lockPath: string): Promise<boolean> {
	const [contents, metadata] = await Promise.all([
		readFile(lockPath, "utf8").catch(() => ""),
		stat(lockPath).catch(() => null),
	]);
	try {
		const parsed = JSON.parse(contents) as { pid?: unknown };
		if (typeof parsed.pid === "number" && Number.isInteger(parsed.pid)) {
			try {
				process.kill(parsed.pid, 0);
				return false;
			} catch (error) {
				if (isNodeError(error, "ESRCH")) return true;
				return false;
			}
		}
	} catch {
		// A malformed lock is recoverable only after a bounded stale interval.
	}
	return Boolean(metadata && Date.now() - metadata.mtimeMs > 60 * 60 * 1000);
}

function isNodeError(error: unknown, code: string): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === code
	);
}

export function safeErrorCode(error: unknown): string {
	const value = error instanceof Error ? error.message : "unknown_error";
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "_")
		.slice(0, 100);
}
