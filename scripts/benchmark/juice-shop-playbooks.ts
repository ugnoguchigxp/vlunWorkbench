import { readFile } from "node:fs/promises";
import { z } from "zod";
import { juiceShopRunnerFamilySchema } from "./juice-shop-observations";

const httpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH"]);

export const juiceShopCatalogSchema = z.object({
	schemaVersion: z.literal(1),
	catalogVersion: z.string().min(1),
	corpusVersion: z.string().min(1),
	scenarios: z
		.array(
			z.object({
				id: z.string().regex(/^juice-[a-z0-9-]+$/),
				challengeKey: z.string().min(1),
				category: z.string().min(1),
				cwe: z.array(z.string().regex(/^CWE-\d+$/)).min(1),
				actors: z.array(z.string().min(1)).min(1),
				entrypoints: z.array(z.string().startsWith("/")).min(1),
				expectedEvidenceKind: z.string().min(1),
				scannerFamilies: z.array(z.string().min(1)).min(1),
				pairedFixedFixture: z.string().min(1),
			}),
		)
		.length(20),
});

export const juiceShopPlaybookSchema = z.object({
	schemaVersion: z.literal(1),
	scenarioId: z.string().regex(/^juice-[a-z0-9-]+$/),
	controlId: z.string().regex(/^[a-z0-9][a-z0-9/-]+$/),
	runnerFamily: juiceShopRunnerFamilySchema,
	probeVariant: z.enum([
		"admin_route",
		"basket_cross_actor",
		"forged_review",
		"forged_feedback",
		"sql_login_admin",
		"sql_login_bender",
		"sql_user_credentials",
		"dom_xss",
		"reflected_xss",
		"stored_xss",
		"weak_password",
		"reset_workflow",
		"captcha_replay",
		"locale_allowlist",
		"local_file_read",
		"developer_backup",
		"negative_order",
		"zero_stars",
		"deluxe_transition",
		"outbound_canary",
	]),
	methods: z.array(httpMethodSchema).min(1).max(4),
	allowedPathPrefixes: z.array(z.string().startsWith("/")).min(1).max(10),
	maxRequests: z.number().int().min(1).max(50),
	timeoutMs: z.number().int().min(100).max(30_000),
	expectedEvidenceKind: z.string().min(1),
});

export type JuiceShopCatalog = z.infer<typeof juiceShopCatalogSchema>;
export type JuiceShopPlaybook = z.infer<typeof juiceShopPlaybookSchema>;

export const JUICE_SHOP_PLAYBOOKS: JuiceShopPlaybook[] = [
	playbook(
		"juice-admin-section",
		"authorization/admin-section",
		"browser",
		"admin_route",
		["GET", "POST"],
		["/", "/administration", "/rest/user/login", "/api/Users"],
	),
	playbook(
		"juice-view-basket",
		"authorization/view-basket",
		"authorization",
		"basket_cross_actor",
		["POST", "GET"],
		["/rest/user/login", "/rest/basket/"],
	),
	playbook(
		"juice-forged-review",
		"authorization/forged-review",
		"business_logic",
		"forged_review",
		["POST", "GET", "PATCH"],
		["/rest/user/login", "/rest/products/"],
	),
	playbook(
		"juice-forged-feedback",
		"authorization/forged-feedback",
		"business_logic",
		"forged_feedback",
		["POST", "GET"],
		["/rest/user/login", "/rest/captcha", "/api/Feedbacks"],
	),
	playbook(
		"juice-login-admin",
		"injection/login-admin",
		"bounded_http",
		"sql_login_admin",
		["POST"],
		["/rest/user/login"],
	),
	playbook(
		"juice-login-bender",
		"injection/login-bender",
		"bounded_http",
		"sql_login_bender",
		["POST"],
		["/rest/user/login"],
	),
	playbook(
		"juice-user-credentials",
		"injection/user-credentials",
		"bounded_http",
		"sql_user_credentials",
		["GET"],
		["/rest/products/search"],
	),
	playbook(
		"juice-dom-xss",
		"xss/dom-xss",
		"browser",
		"dom_xss",
		["GET"],
		["/", "/search"],
	),
	playbook(
		"juice-reflected-xss",
		"xss/reflected-xss",
		"browser",
		"reflected_xss",
		["GET"],
		["/", "/track-result"],
	),
	playbook(
		"juice-api-only-xss",
		"xss/api-only-xss",
		"bounded_http",
		"stored_xss",
		["POST", "GET"],
		["/rest/user/login", "/api/Products", "/rest/products/search"],
	),
	playbook(
		"juice-weak-password",
		"authentication/weak-password",
		"business_logic",
		"weak_password",
		["POST"],
		["/rest/user/login"],
	),
	playbook(
		"juice-reset-token",
		"authentication/reset-token",
		"business_logic",
		"reset_workflow",
		["GET"],
		["/rest/user/security-question", "/rest/user/reset-password"],
	),
	playbook(
		"juice-captcha-bypass",
		"anti-automation/captcha-bypass",
		"business_logic",
		"captcha_replay",
		["GET", "POST"],
		["/rest/captcha", "/api/Feedbacks"],
		30,
	),
	playbook(
		"juice-extra-language",
		"input-validation/extra-language",
		"bounded_http",
		"locale_allowlist",
		["GET"],
		["/assets/i18n/"],
	),
	playbook(
		"juice-local-file-read",
		"file-access/local-file-read",
		"bounded_http",
		"local_file_read",
		["POST"],
		["/rest/user/login", "/dataerasure"],
	),
	playbook(
		"juice-forgotten-developer-backup",
		"file-access/developer-backup",
		"bounded_http",
		"developer_backup",
		["GET"],
		["/ftp/"],
	),
	playbook(
		"juice-negative-order",
		"business-logic/negative-order",
		"business_logic",
		"negative_order",
		["POST", "PUT"],
		["/rest/user/login", "/api/BasketItems/"],
	),
	playbook(
		"juice-zero-stars",
		"business-logic/zero-stars",
		"business_logic",
		"zero_stars",
		["GET", "POST"],
		["/rest/captcha", "/api/Feedbacks"],
	),
	playbook(
		"juice-deluxe-fraud",
		"business-logic/deluxe-fraud",
		"business_logic",
		"deluxe_transition",
		["POST"],
		["/rest/user/login", "/rest/deluxe-membership"],
	),
	playbook(
		"juice-blockchain-hype",
		"ssrf/blockchain-hype",
		"outbound_canary",
		"outbound_canary",
		["GET"],
		["/", "/tokensale-ico-ea", "/api/Products"],
	),
].map((value) => juiceShopPlaybookSchema.parse(value));

export async function loadAndValidateJuiceShopInputs(
	params: { catalogPath?: string; fixedControlPath?: string } = {},
): Promise<{
	catalog: JuiceShopCatalog;
	playbooks: JuiceShopPlaybook[];
}> {
	const catalog = juiceShopCatalogSchema.parse(
		JSON.parse(
			await readFile(
				params.catalogPath ??
					"spec/security-capability/juice-shop-ground-truth.v1.json",
				"utf8",
			),
		),
	);
	const fixed = z
		.object({
			schemaVersion: z.number().int().positive(),
			pairs: z.array(
				z.object({
					scenarioId: z.string(),
					controlId: z.string().min(1),
					fixedControl: z.string().min(1),
				}),
			),
		})
		.parse(
			JSON.parse(
				await readFile(
					params.fixedControlPath ??
						"tests/security-capability/juice-shop/paired-fixtures.json",
					"utf8",
				),
			),
		);
	const catalogIds = catalog.scenarios.map((scenario) => scenario.id);
	const playbookIds = JUICE_SHOP_PLAYBOOKS.map(
		(playbook) => playbook.scenarioId,
	);
	const fixedIds = fixed.pairs.map((pair) => pair.scenarioId);
	for (const [label, ids] of [
		["catalog", catalogIds],
		["playbook", playbookIds],
		["fixed", fixedIds],
	] as const) {
		if (new Set(ids).size !== ids.length)
			throw new Error(`juice_shop_${label}_duplicate`);
	}
	if (
		JSON.stringify([...catalogIds].sort()) !==
			JSON.stringify([...playbookIds].sort()) ||
		JSON.stringify([...catalogIds].sort()) !==
			JSON.stringify([...fixedIds].sort())
	) {
		throw new Error("juice_shop_catalog_playbook_pair_mismatch");
	}
	const scenarioById = new Map(
		catalog.scenarios.map((scenario) => [scenario.id, scenario]),
	);
	const fixedById = new Map(fixed.pairs.map((pair) => [pair.scenarioId, pair]));
	for (const playbook of JUICE_SHOP_PLAYBOOKS) {
		const scenario = scenarioById.get(playbook.scenarioId);
		const pair = fixedById.get(playbook.scenarioId);
		if (
			!scenario ||
			!pair ||
			scenario.pairedFixedFixture !== playbook.controlId ||
			pair.controlId !== playbook.controlId ||
			scenario.expectedEvidenceKind !== playbook.expectedEvidenceKind ||
			!scenario.entrypoints.every((entrypoint) =>
				playbook.allowedPathPrefixes.some((prefix) =>
					entrypoint.replace(/\{[^}]+\}/g, "").startsWith(prefix),
				),
			)
		) {
			throw new Error(
				`juice_shop_playbook_contract_mismatch:${playbook.scenarioId}`,
			);
		}
	}
	return { catalog, playbooks: JUICE_SHOP_PLAYBOOKS };
}

function playbook(
	scenarioId: JuiceShopPlaybook["scenarioId"],
	controlId: string,
	runnerFamily: JuiceShopPlaybook["runnerFamily"],
	probeVariant: JuiceShopPlaybook["probeVariant"],
	methods: JuiceShopPlaybook["methods"],
	allowedPathPrefixes: string[],
	maxRequests = 12,
): JuiceShopPlaybook {
	const evidenceKinds: Record<string, string> = {
		"juice-admin-section": "authorization_matrix",
		"juice-view-basket": "cross_actor_status_and_object",
		"juice-forged-review": "owner_isolation",
		"juice-forged-feedback": "actor_identity_mismatch",
		"juice-login-admin": "bounded_sql_injection",
		"juice-login-bender": "bounded_sql_injection",
		"juice-user-credentials": "bounded_sql_injection",
		"juice-dom-xss": "browser_dom_sink",
		"juice-reflected-xss": "reflected_payload",
		"juice-api-only-xss": "stored_payload",
		"juice-weak-password": "credential_policy",
		"juice-reset-token": "one_time_token_reuse",
		"juice-captcha-bypass": "replay_sequence",
		"juice-extra-language": "path_allowlist",
		"juice-local-file-read": "path_traversal",
		"juice-forgotten-developer-backup": "sensitive_file_exposure",
		"juice-negative-order": "bounded_numeric_delta",
		"juice-zero-stars": "numeric_boundary",
		"juice-deluxe-fraud": "state_transition",
		"juice-blockchain-hype": "outbound_request_canary",
	};
	return {
		schemaVersion: 1,
		scenarioId,
		controlId,
		runnerFamily,
		probeVariant,
		methods,
		allowedPathPrefixes,
		maxRequests,
		timeoutMs: 10_000,
		expectedEvidenceKind: evidenceKinds[scenarioId] ?? "unknown",
	};
}
