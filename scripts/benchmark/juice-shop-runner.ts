import crypto from "node:crypto";
import { open, rm } from "node:fs/promises";
import path from "node:path";
import type { DastFetch } from "../../api/modules/dast/http-runner";
import type { ActiveResetExecutor } from "../../api/modules/runtime-scans/zap-active-runner";
import {
	createContainerFixtureLoopbackFetch,
	createContainerFixtureResetExecutor,
	listContainerFixtures,
} from "../../api/modules/runtime-scans/container-fixture-reset";
import {
	detectSecurityProbe,
	type SecurityProbe,
	type SecurityProbeFinding,
} from "../../api/modules/dast/security-probe-detector";
import { executeJuiceShopFixedControl } from "../../tests/security-capability/juice-shop/fixed-app";
import {
	type JuiceShopObservation,
	juiceShopObservationSchema,
} from "./juice-shop-observations";
import {
	responseShapeHash,
	type JuiceShopRequestEvidence,
	writeJuiceShopExecutionEvidence,
} from "./juice-shop-evidence";
import type {
	JuiceShopCatalog,
	JuiceShopPlaybook,
} from "./juice-shop-playbooks";

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
	const resetExecutor =
		params.resetExecutor ??
		createContainerFixtureResetExecutor({
			strategy: resetStrategy,
			targetOrigin,
			fetchImpl: createContainerFixtureLoopbackFetch({
				fixtureId: FIXTURE_ID,
			}),
		});
	const targetFetch = params.resetExecutor
		? fetch
		: createContainerFixtureLoopbackFetch({ fixtureId: FIXTURE_ID });
	const lockPath = path.resolve(".artifacts/benchmark/juice-shop.lock");
	const releaseLock = await acquireLock(lockPath).catch(() => null);
	if (!releaseLock) {
		return {
			observations: blockedObservations(
				params.playbooks,
				"shared_fixture_busy",
			),
			preflight: {
				status: "blocked",
				platform: process.platform,
				fixtureId: FIXTURE_ID,
				image: fixture.image,
				targetOrigin,
				authoritativeLinux: process.platform === "linux",
				errorCode: "shared_fixture_busy",
			},
		};
	}
	const observations: JuiceShopObservation[] = [];
	const scenarioById = new Map(
		params.catalog.scenarios.map((scenario) => [scenario.id, scenario]),
	);
	let preflightError: string | null = null;
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
							method: playbook.methods[0] ?? "GET",
							path: playbook.allowedPathPrefixes[0] ?? "/",
							queryKeys: [],
							status: probeStatus(fixed.probe),
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
							targetRequestCount:
								vulnerable.requests.length + fixed.requestCount,
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
	): Promise<{ status: number; json: unknown; text: string }> {
		const url = new URL(requestPath, this.origin);
		if (url.origin !== this.origin)
			throw new Error("juice_shop_origin_mismatch");
		const method = (init.method ?? "GET").toUpperCase();
		if (!this.playbook.methods.includes(method as never))
			throw new Error(`juice_shop_method_not_allowed:${method}`);
		if (
			!this.playbook.allowedPathPrefixes.some((prefix) =>
				url.pathname.startsWith(prefix),
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
		return { status: response.status, json, text };
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
		case "dom_xss":
		case "reflected_xss": {
			const marker = "vw-xss-marker";
			const route =
				playbook.probeVariant === "dom_xss"
					? `/?q=${marker}`
					: `/track-result?id=${marker}`;
			const response = await client.request(route);
			return {
				kind: "html_injection",
				cwe: "CWE-79",
				status: response.status,
				marker,
				markerObserved: response.text.includes(marker),
				executableMarkupPreserved: false,
			};
		}
		case "stored_xss": {
			const auth = await login(client, "admin@juice-sh.op", "admin123");
			const marker = `vw-xss-${crypto.randomUUID().slice(0, 8)}`;
			const markup = `<iframe src="javascript:void('${marker}')">`;
			const created = await client.request("/api/Products", {
				method: "POST",
				headers: {
					...bearer(auth.token),
					"content-type": "application/json",
				},
				body: JSON.stringify({
					name: marker,
					description: markup,
					price: 47.11,
				}),
			});
			const stored = record(record(created.json)?.data)?.description;
			return {
				kind: "html_injection",
				cwe: "CWE-79",
				status: created.status,
				marker,
				markerObserved: String(stored ?? "").includes(marker),
				executableMarkupPreserved: String(stored ?? "").includes("<iframe"),
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
		case "reset_workflow": {
			const response = await client.request(
				"/rest/user/security-question?email=jim%40juice-sh.op",
			);
			return {
				kind: "replay_protection",
				cwe,
				attemptCount: 1,
				acceptedCount: response.status === 200 ? 1 : 0,
				nonceReuseObserved: false,
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
		case "outbound_canary": {
			const response = await client.request("/");
			return {
				kind: "outbound_request",
				cwe: "CWE-918",
				status: response.status,
				untrustedDestinationSupplied: false,
				localCanaryHits: 0,
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
): Promise<{ id: number; answer: number }> {
	const response = await client.request("/rest/captcha/");
	const body = record(response.json);
	const id = Number(body?.captchaId);
	const answer = Number(body?.answer);
	if (
		response.status !== 200 ||
		!Number.isFinite(id) ||
		!Number.isFinite(answer)
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

function probeStatus(probe: SecurityProbe): number {
	if ("status" in probe) return probe.status;
	if ("probeStatus" in probe) return probe.probeStatus;
	return 200;
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
	const handle = await open(lockPath, "wx", 0o600);
	return async () => {
		await handle.close();
		await rm(lockPath, { force: true });
	};
}

function safeErrorCode(error: unknown): string {
	const value = error instanceof Error ? error.message : "unknown_error";
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "_")
		.slice(0, 100);
}
