import type {
	BusinessLogicScenario,
	ScenarioAssertion,
	ScenarioRequest,
} from "../../../shared/schemas/business-logic.schema";

export type ScenarioHttpResult = {
	status: number;
	json?: unknown;
	evidenceRef: string;
};

export type ScenarioHttpExecutor = (
	request: ScenarioRequest,
	context: { stage: "seed" | "action" | "cleanup"; index: number },
) => Promise<ScenarioHttpResult>;

export type ScenarioStateObserver = (
	assertion: ScenarioAssertion,
	phase: "precondition" | "invariant" | "baseline",
) => Promise<boolean>;

export type BusinessLogicExecutionResult = {
	status:
		| "observed"
		| "not_observed"
		| "inconclusive"
		| "failed_cleanup"
		| "not_tested";
	requestCount: number;
	evidenceRefs: string[];
	violatedInvariantIndexes: number[];
	cleanupSucceeded: boolean;
	errors: string[];
};

export async function executeBusinessLogicScenario(params: {
	scenario: BusinessLogicScenario;
	execute: ScenarioHttpExecutor;
	observe?: ScenarioStateObserver;
}): Promise<BusinessLogicExecutionResult> {
	const actionResults: ScenarioHttpResult[] = [];
	const evidenceRefs: string[] = [];
	const violatedInvariantIndexes: number[] = [];
	const errors: string[] = [];
	let requestCount = 0;
	let operationFailed = false;
	let cleanupFailed = false;
	const runRequest = async (
		request: ScenarioRequest,
		stage: "seed" | "action" | "cleanup",
		index: number,
	): Promise<ScenarioHttpResult> => {
		requestCount++;
		if (requestCount > params.scenario.maxRequests)
			throw new Error("business_logic_request_budget_exhausted");
		const result = await params.execute(request, { stage, index });
		evidenceRefs.push(result.evidenceRef);
		if (!request.expectedStatus.includes(result.status))
			throw new Error(
				`business_logic_unexpected_status:${request.method}:${request.path}:${result.status}`,
			);
		if (result.status >= 500)
			throw new Error(`business_logic_server_error:${result.status}`);
		return result;
	};
	for (const precondition of params.scenario.preconditions) {
		if (
			!(await evaluateAssertion(
				precondition,
				[],
				params.observe,
				"precondition",
			))
		)
			return {
				status: "not_tested",
				requestCount,
				evidenceRefs,
				violatedInvariantIndexes,
				cleanupSucceeded: false,
				errors: ["business_logic_precondition_not_met"],
			};
	}
	try {
		for (const [index, request] of params.scenario.seed.entries())
			await runRequest(request, "seed", index);
		for (const [index, request] of params.scenario.actions.entries())
			actionResults.push(await runRequest(request, "action", index));
		for (const [index, invariant] of params.scenario.invariants.entries()) {
			if (
				!(await evaluateAssertion(
					invariant,
					actionResults,
					params.observe,
					"invariant",
				))
			)
				violatedInvariantIndexes.push(index);
		}
	} catch (error) {
		operationFailed = true;
		errors.push(
			error instanceof Error
				? error.message
				: "business_logic_execution_failed",
		);
	} finally {
		for (const [index, request] of params.scenario.cleanup.entries()) {
			try {
				await runRequest(request, "cleanup", index);
			} catch (error) {
				cleanupFailed = true;
				errors.push(
					error instanceof Error
						? error.message
						: "business_logic_cleanup_failed",
				);
			}
		}
		if (params.scenario.expectedBaselineHash) {
			const baselineOk = params.observe
				? await params.observe(
						{
							kind: "fixture_hash",
							expectedHash: params.scenario.expectedBaselineHash,
						},
						"baseline",
					)
				: false;
			if (!baselineOk) {
				cleanupFailed = true;
				errors.push(
					params.observe
						? "business_logic_baseline_mismatch"
						: "business_logic_baseline_observer_unavailable",
				);
			}
		}
	}
	return {
		status: cleanupFailed
			? "failed_cleanup"
			: operationFailed
				? "inconclusive"
				: violatedInvariantIndexes.length > 0
					? "observed"
					: "not_observed",
		requestCount,
		evidenceRefs,
		violatedInvariantIndexes,
		cleanupSucceeded: !cleanupFailed,
		errors,
	};
}

async function evaluateAssertion(
	assertion: ScenarioAssertion,
	actionResults: ScenarioHttpResult[],
	observe: ScenarioStateObserver | undefined,
	phase: "precondition" | "invariant",
): Promise<boolean> {
	if (assertion.kind === "status_class") {
		const result = actionResults[assertion.requestIndex];
		return Boolean(
			result && Math.floor(result.status / 100) === assertion.expectedClass,
		);
	}
	if (assertion.kind === "json_primitive") {
		const result = actionResults[assertion.requestIndex];
		const actual = result
			? jsonPointer(result.json, assertion.jsonPointer)
			: undefined;
		return assertion.operator === "eq"
			? actual === assertion.value
			: actual !== assertion.value;
	}
	if (!observe)
		throw new Error(`business_logic_observer_required:${assertion.kind}`);
	return await observe(assertion, phase);
}

function jsonPointer(value: unknown, pointer: string): unknown {
	let current = value;
	for (const rawSegment of pointer.slice(1).split("/")) {
		const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}
