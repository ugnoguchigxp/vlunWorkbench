import type { SecurityProbe } from "../../../../api/modules/dast/security-probe-detector";
import type { JuiceShopPlaybook } from "../../../../scripts/benchmark/juice-shop-playbooks";

export type FixedControlExecution = {
	status: "completed";
	request: { method: string; path: string; status: number };
	probe: SecurityProbe;
	controlId: string;
};

export function executeJuiceShopFixedControl(params: {
	playbook: JuiceShopPlaybook;
	cwe: string;
}): FixedControlExecution {
	const { playbook, cwe } = params;
	const common = {
		status: "completed" as const,
		request: fixedControlRequest(playbook),
		controlId: playbook.controlId,
	};
	switch (playbook.probeVariant) {
		case "admin_route":
		case "basket_cross_actor":
			return {
				...common,
				probe: {
					kind: "authorization",
					cwe,
					status: 403,
					expectedDenied: true,
					actorRole: "customer-a",
					ownerRole:
						playbook.probeVariant === "basket_cross_actor"
							? "customer-b"
							: "admin",
					protectedObjectPresent: false,
				},
			};
		case "forged_review":
		case "forged_feedback":
			return {
				...common,
				probe: {
					kind: "identity_integrity",
					cwe,
					status: 403,
					mutationAccepted: false,
					authenticatedUserId: "actor-a",
					persistedUserId: null,
					entityOwnerMismatch: false,
				},
			};
		case "sql_login_admin":
		case "sql_login_bender":
			return {
				...common,
				probe: {
					kind: "sql_authentication",
					cwe: "CWE-89",
					controlStatus: 401,
					probeStatus: 401,
					controlTokenPresent: false,
					probeTokenPresent: false,
				},
			};
		case "sql_user_credentials":
			return {
				...common,
				probe: {
					kind: "sql_data_exposure",
					cwe: "CWE-89",
					status: 200,
					controlRowCount: 0,
					probeRowCount: 0,
					sensitiveFieldsPresent: false,
				},
			};
		case "sensitive_document":
		case "exposed_metrics":
			return {
				...common,
				probe: {
					kind: "sensitive_endpoint",
					cwe: "CWE-200",
					status: 403,
					unauthenticated: true,
					expectedPrivate: true,
					sensitiveContentFingerprintPresent: false,
				},
			};
		case "redirect_allowlist_bypass":
		case "outdated_redirect":
			return {
				...common,
				probe: {
					kind: "redirect_policy",
					cwe: "CWE-601",
					status: 406,
					suppliedDestination: "https://attacker.invalid/",
					redirectLocation: null,
					destinationAllowedByPolicy: false,
				},
			};
		case "weak_password":
			return {
				...common,
				probe: {
					kind: "weak_credential",
					cwe: "CWE-521",
					status: 401,
					authenticated: false,
					passwordInBoundedCommonList: true,
				},
			};
		case "knowledge_factor_reset":
			return {
				...common,
				probe: {
					kind: "knowledge_factor_reset",
					cwe: "CWE-640",
					status: 401,
					unauthenticated: true,
					publiclyDiscoverableAnswerUsed: true,
					passwordChanged: false,
				},
			};
		case "captcha_replay":
			return {
				...common,
				probe: {
					kind: "replay_protection",
					cwe,
					attemptCount: 2,
					acceptedCount: 1,
					nonceReuseObserved: false,
				},
			};
		case "locale_allowlist":
			return {
				...common,
				probe: {
					kind: "allowlist",
					cwe,
					status: 404,
					suppliedValue: "tlh_AA",
					valueAllowed: false,
					resourceReturned: false,
				},
			};
		case "local_file_read":
		case "developer_backup":
			return {
				...common,
				probe: {
					kind: "file_exposure",
					cwe,
					status: 404,
					traversalSyntaxUsed: playbook.probeVariant === "local_file_read",
					sensitiveExtensionRequested:
						playbook.probeVariant === "developer_backup",
					sensitiveContentFingerprintPresent: false,
				},
			};
		case "negative_order":
		case "zero_stars":
			return {
				...common,
				probe: {
					kind: "numeric_boundary",
					cwe: "CWE-20",
					status: 400,
					suppliedValue:
						playbook.probeVariant === "negative_order" ? -100_000 : 0,
					acceptedValue: null,
					minimum: 1,
				},
			};
		case "deluxe_transition":
			return {
				...common,
				probe: {
					kind: "state_transition",
					cwe,
					status: 400,
					requiredPreconditionPresent: false,
					transitionCompleted: false,
				},
			};
	}
}

function fixedControlRequest(
	playbook: JuiceShopPlaybook,
): FixedControlExecution["request"] {
	switch (playbook.probeVariant) {
		case "admin_route":
			return { method: "GET", path: "/api/Users", status: 403 };
		case "basket_cross_actor":
			return { method: "GET", path: "/rest/basket/2", status: 403 };
		case "forged_review":
			return { method: "PATCH", path: "/rest/products/reviews", status: 403 };
		case "forged_feedback":
			return { method: "POST", path: "/api/Feedbacks", status: 403 };
		case "sql_login_admin":
		case "sql_login_bender":
			return { method: "POST", path: "/rest/user/login", status: 401 };
		case "sql_user_credentials":
			return { method: "GET", path: "/rest/products/search", status: 200 };
		case "sensitive_document":
			return { method: "GET", path: "/ftp/acquisitions.md", status: 403 };
		case "exposed_metrics":
			return { method: "GET", path: "/metrics", status: 403 };
		case "redirect_allowlist_bypass":
		case "outdated_redirect":
			return { method: "GET", path: "/redirect", status: 406 };
		case "weak_password":
			return { method: "POST", path: "/rest/user/login", status: 401 };
		case "knowledge_factor_reset":
			return {
				method: "POST",
				path: "/rest/user/reset-password",
				status: 401,
			};
		case "captcha_replay":
			return { method: "POST", path: "/api/Feedbacks", status: 409 };
		case "locale_allowlist":
			return { method: "GET", path: "/assets/i18n/tlh_AA.json", status: 404 };
		case "local_file_read":
			return { method: "POST", path: "/dataerasure", status: 404 };
		case "developer_backup":
			return { method: "GET", path: "/ftp/package.json.bak", status: 404 };
		case "negative_order":
			return { method: "PUT", path: "/api/BasketItems/1", status: 400 };
		case "zero_stars":
			return { method: "POST", path: "/api/Feedbacks", status: 400 };
		case "deluxe_transition":
			return {
				method: "POST",
				path: "/rest/deluxe-membership",
				status: 400,
			};
	}
}
