import type { SecurityProbe } from "../../../../api/modules/dast/security-probe-detector";
import type { JuiceShopPlaybook } from "../../../../scripts/benchmark/juice-shop-playbooks";

export type FixedControlExecution = {
	status: "completed";
	requestCount: number;
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
		requestCount: Math.min(playbook.maxRequests, 2),
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
		case "dom_xss":
		case "reflected_xss":
		case "stored_xss":
			return {
				...common,
				probe: {
					kind: "html_injection",
					cwe: "CWE-79",
					status: 200,
					marker: "vw-xss-marker",
					markerObserved: false,
					executableMarkupPreserved: false,
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
		case "reset_workflow":
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
		case "outbound_canary":
			return {
				...common,
				probe: {
					kind: "outbound_request",
					cwe: "CWE-918",
					status: 400,
					untrustedDestinationSupplied: true,
					localCanaryHits: 0,
				},
			};
	}
}
