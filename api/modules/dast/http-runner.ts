import type { DastAuthSecretPayload } from "../../../shared/schemas/dast-auth.schema";
import { runBoundedHttpAssessment, type DastFetch } from "./bounded-crawler";
import type { DastProfileDefinition } from "./profiles";
import type { DastHttpRawResult, ValidatedDastTarget } from "./types";

export type { DastFetch } from "./bounded-crawler";

export async function runHttpBaseline(params: {
	target: ValidatedDastTarget;
	profile: DastProfileDefinition;
	profileConfigRoutes?: string[];
	checkOptions?: Record<string, unknown>;
	timeoutSec?: number;
	maxRequests?: number;
	fetchImpl?: DastFetch;
	authSecret?: DastAuthSecretPayload;
	projectRoot?: string;
}): Promise<DastHttpRawResult> {
	return await runBoundedHttpAssessment(params);
}
