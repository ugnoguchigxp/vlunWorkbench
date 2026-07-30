import type { AuthorizationMatrix } from "../../../shared/schemas/active-assessment.schema";

type MatrixActor = AuthorizationMatrix["actors"][number];
type MatrixObject = AuthorizationMatrix["objects"][number];
type MatrixOperation = AuthorizationMatrix["operations"][number];

export type AuthorizationMatrixExecutor = (params: {
	actor: MatrixActor;
	object: MatrixObject;
	operation: MatrixOperation;
	path: string;
}) => Promise<{ status: number; evidenceRef: string }>;

export type AuthorizationMatrixFinding = {
	ruleId: "BOLA" | "BFLA" | "AUTHORIZATION_FALSE_DENY";
	title: string;
	actorRole: string;
	objectId: string;
	operationId: string;
	expected: "allowed" | "denied";
	observed: "allowed" | "denied" | "inconclusive";
	status: number;
	evidenceRef: string;
};

export async function runAuthorizationMatrix(params: {
	matrix: AuthorizationMatrix;
	execute: AuthorizationMatrixExecutor;
	maxRequests: number;
}): Promise<{
	findings: AuthorizationMatrixFinding[];
	requestCount: number;
	evidenceRefs: string[];
	inconclusiveCount: number;
}> {
	const findings: AuthorizationMatrixFinding[] = [];
	const evidenceRefs: string[] = [];
	let requestCount = 0;
	let inconclusiveCount = 0;
	for (const operation of params.matrix.operations) {
		for (const object of params.matrix.objects) {
			for (const actor of params.matrix.actors) {
				requestCount++;
				if (requestCount > params.maxRequests) {
					throw new Error("authorization_matrix_request_budget_exhausted");
				}
				const path = operation.pathTemplate.replace(
					"{objectId}",
					encodeURIComponent(object.id),
				);
				const result = await params.execute({
					actor,
					object,
					operation,
					path,
				});
				evidenceRefs.push(result.evidenceRef);
				const expected =
					(operation.ownerAllowed && actor.identityRole === object.ownerRole) ||
					operation.allowedRoles.includes(actor.identityRole)
						? "allowed"
						: "denied";
				const observed = observedAuthorization(result.status);
				if (observed === "inconclusive") {
					inconclusiveCount++;
					continue;
				}
				if (observed === expected) continue;
				findings.push({
					ruleId:
						expected === "allowed"
							? "AUTHORIZATION_FALSE_DENY"
							: operation.ownerAllowed
								? "BOLA"
								: "BFLA",
					title:
						expected === "denied"
							? `Authorization bypass: ${actor.identityRole} accessed ${object.id}`
							: `Expected authorization failed: ${actor.identityRole} on ${object.id}`,
					actorRole: actor.identityRole,
					objectId: object.id,
					operationId: operation.id,
					expected,
					observed,
					status: result.status,
					evidenceRef: result.evidenceRef,
				});
			}
		}
	}
	return { findings, requestCount, evidenceRefs, inconclusiveCount };
}

function observedAuthorization(
	status: number,
): "allowed" | "denied" | "inconclusive" {
	if (status >= 200 && status < 300) return "allowed";
	if ([401, 403, 404].includes(status)) return "denied";
	return "inconclusive";
}
