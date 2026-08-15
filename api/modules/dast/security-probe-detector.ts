import crypto from "node:crypto";

export type SecurityProbe =
	| {
			kind: "authorization";
			cwe: string;
			status: number;
			expectedDenied: boolean;
			actorRole: string;
			ownerRole: string | null;
			protectedObjectPresent: boolean;
	  }
	| {
			kind: "identity_integrity";
			cwe: string;
			status: number;
			mutationAccepted: boolean;
			authenticatedUserId: string | null;
			persistedUserId: string | null;
			entityOwnerMismatch: boolean;
	  }
	| {
			kind: "sql_authentication";
			cwe: "CWE-89";
			controlStatus: number;
			probeStatus: number;
			controlTokenPresent: boolean;
			probeTokenPresent: boolean;
	  }
	| {
			kind: "sql_data_exposure";
			cwe: "CWE-89";
			status: number;
			controlRowCount: number;
			probeRowCount: number;
			sensitiveFieldsPresent: boolean;
	  }
	| {
			kind: "html_injection";
			cwe: "CWE-79";
			status: number;
			marker: string;
			markerObserved: boolean;
			executableMarkupPreserved: boolean;
	  }
	| {
			kind: "weak_credential";
			cwe: "CWE-521";
			status: number;
			authenticated: boolean;
			passwordInBoundedCommonList: boolean;
	  }
	| {
			kind: "replay_protection";
			cwe: string;
			attemptCount: number;
			acceptedCount: number;
			nonceReuseObserved: boolean;
	  }
	| {
			kind: "allowlist";
			cwe: string;
			status: number;
			suppliedValue: string;
			valueAllowed: boolean;
			resourceReturned: boolean;
	  }
	| {
			kind: "file_exposure";
			cwe: string;
			status: number;
			traversalSyntaxUsed: boolean;
			sensitiveExtensionRequested: boolean;
			sensitiveContentFingerprintPresent: boolean;
	  }
	| {
			kind: "numeric_boundary";
			cwe: "CWE-20";
			status: number;
			suppliedValue: number;
			acceptedValue: number | null;
			minimum: number;
	  }
	| {
			kind: "state_transition";
			cwe: string;
			status: number;
			requiredPreconditionPresent: boolean;
			transitionCompleted: boolean;
	  }
	| {
			kind: "outbound_request";
			cwe: "CWE-918";
			status: number;
			untrustedDestinationSupplied: boolean;
			localCanaryHits: number;
	  }
	| {
			kind: "observation_only";
			cwe: string;
			status: number;
			reliable: boolean;
	  };

export type SecurityProbeFinding = {
	id: string;
	ruleId:
		| "AUTHORIZATION_BYPASS"
		| "IDENTITY_INTEGRITY"
		| "SQL_INJECTION"
		| "HTML_INJECTION"
		| "WEAK_CREDENTIAL"
		| "REPLAY_PROTECTION"
		| "ALLOWLIST_BYPASS"
		| "SENSITIVE_FILE_EXPOSURE"
		| "NUMERIC_BOUNDARY"
		| "STATE_TRANSITION"
		| "SSRF_CANARY";
	cwe: string;
	title: string;
};

export function detectSecurityProbe(
	probe: SecurityProbe,
	context: { scenarioId: string; targetKind: "vulnerable" | "fixed" },
): SecurityProbeFinding[] {
	const detected = detectorDecision(probe);
	if (!detected) return [];
	const id = `probe:${crypto
		.createHash("sha256")
		.update(
			JSON.stringify({
				scenarioId: context.scenarioId,
				targetKind: context.targetKind,
				kind: probe.kind,
				cwe: probe.cwe,
			}),
		)
		.digest("hex")
		.slice(0, 24)}`;
	return [{ id, cwe: probe.cwe, ...detected }];
}

function detectorDecision(
	probe: SecurityProbe,
): Pick<SecurityProbeFinding, "ruleId" | "title"> | null {
	switch (probe.kind) {
		case "authorization":
			return probe.expectedDenied &&
				probe.status >= 200 &&
				probe.status < 300 &&
				probe.protectedObjectPresent &&
				probe.actorRole !== probe.ownerRole
				? {
						ruleId: "AUTHORIZATION_BYPASS",
						title: "A non-owner accessed a protected object",
					}
				: null;
		case "identity_integrity":
			return probe.status >= 200 &&
				probe.status < 300 &&
				probe.mutationAccepted &&
				(probe.entityOwnerMismatch ||
					(probe.authenticatedUserId !== null &&
						probe.persistedUserId !== null &&
						probe.authenticatedUserId !== probe.persistedUserId))
				? {
						ruleId: "IDENTITY_INTEGRITY",
						title: "A mutation was persisted under another identity",
					}
				: null;
		case "sql_authentication":
			return !probe.controlTokenPresent &&
				probe.controlStatus >= 400 &&
				probe.probeStatus >= 200 &&
				probe.probeStatus < 300 &&
				probe.probeTokenPresent
				? {
						ruleId: "SQL_INJECTION",
						title: "Input changed a failed authentication into success",
					}
				: null;
		case "sql_data_exposure":
			return probe.status >= 200 &&
				probe.status < 300 &&
				probe.probeRowCount > probe.controlRowCount &&
				probe.sensitiveFieldsPresent
				? {
						ruleId: "SQL_INJECTION",
						title: "Input exposed data outside the control query result",
					}
				: null;
		case "html_injection":
			return probe.status >= 200 &&
				probe.status < 300 &&
				probe.markerObserved &&
				probe.executableMarkupPreserved
				? {
						ruleId: "HTML_INJECTION",
						title: "Untrusted executable markup reached an HTML sink",
					}
				: null;
		case "weak_credential":
			return probe.status >= 200 &&
				probe.status < 300 &&
				probe.authenticated &&
				probe.passwordInBoundedCommonList
				? {
						ruleId: "WEAK_CREDENTIAL",
						title: "A bounded common credential authenticated successfully",
					}
				: null;
		case "replay_protection":
			return probe.attemptCount >= 2 &&
				probe.acceptedCount === probe.attemptCount &&
				probe.nonceReuseObserved
				? {
						ruleId: "REPLAY_PROTECTION",
						title: "A one-time value was accepted more than once",
					}
				: null;
		case "allowlist":
			return !probe.valueAllowed &&
				probe.resourceReturned &&
				probe.status >= 200 &&
				probe.status < 300
				? {
						ruleId: "ALLOWLIST_BYPASS",
						title: "A value outside the allowlist returned a resource",
					}
				: null;
		case "file_exposure":
			return probe.status >= 200 &&
				probe.status < 300 &&
				(probe.traversalSyntaxUsed || probe.sensitiveExtensionRequested) &&
				probe.sensitiveContentFingerprintPresent
				? {
						ruleId: "SENSITIVE_FILE_EXPOSURE",
						title: "A sensitive file was returned through a bounded probe",
					}
				: null;
		case "numeric_boundary":
			return probe.status >= 200 &&
				probe.status < 300 &&
				probe.suppliedValue < probe.minimum &&
				probe.acceptedValue === probe.suppliedValue
				? {
						ruleId: "NUMERIC_BOUNDARY",
						title: "An out-of-range numeric value was accepted",
					}
				: null;
		case "state_transition":
			return !probe.requiredPreconditionPresent &&
				probe.transitionCompleted &&
				probe.status >= 200 &&
				probe.status < 300
				? {
						ruleId: "STATE_TRANSITION",
						title: "A protected state transition skipped its precondition",
					}
				: null;
		case "outbound_request":
			return probe.untrustedDestinationSupplied && probe.localCanaryHits > 0
				? {
						ruleId: "SSRF_CANARY",
						title: "The target reached an internal outbound canary",
					}
				: null;
		case "observation_only":
			return null;
	}
}
