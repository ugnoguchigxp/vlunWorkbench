import type { z } from "zod";
import type { scanTargetSchema } from "../../shared/schemas/scan-target.schema";
import { HttpError } from "../modules/auth/errors";
import {
	normalizeProfileResolutionInput,
	ProfileResolutionError,
	resolveProfileSelection,
} from "../modules/scans/profile-resolution";

export function resolveWebProfileSelection(params: {
	profileId: string;
	target: z.infer<typeof scanTargetSchema>;
	resultPolicy?: "advisory" | "gate";
	allowExperimental?: boolean;
	imageRef?: string;
	imageTar?: string;
	attestationSubject?: string;
	attestationBundle?: string;
	trustPolicy?: string;
	slsaProvenance?: string;
	slsaPolicy?: string;
	authContextId?: string;
	consentProjectCodeExecution?: boolean;
}) {
	try {
		return resolveProfileSelection({
			requestedProfileId: params.profileId,
			surface: "web",
			target: params.target,
			providedInputKinds: normalizeProfileResolutionInput({
				repoPath: "web-project",
				imageRef: params.imageRef,
				imageTar: params.imageTar,
				attestationSubject: params.attestationSubject,
				attestationBundle: params.attestationBundle,
				trustPolicy: params.trustPolicy,
				slsaProvenance: params.slsaProvenance,
				slsaPolicy: params.slsaPolicy,
				authContextRef: params.authContextId,
				executionConsent: params.consentProjectCodeExecution,
			}),
			requestedResultPolicy: params.resultPolicy,
			allowExperimental: params.allowExperimental,
		});
	} catch (error) {
		if (error instanceof ProfileResolutionError) {
			throw new HttpError(400, `${error.code}: ${error.message}`);
		}
		throw error;
	}
}

export function appendScanTargetArgs(
	args: string[],
	target: z.infer<typeof scanTargetSchema>,
): void {
	args.push(
		"--target",
		target.kind === "working_tree" ? "working-tree" : target.kind,
	);
	if ("base" in target && target.base) args.push("--base", target.base);
	if ("head" in target && target.head) args.push("--head", target.head);
	if (target.kind === "working_tree") {
		args.push("--include-untracked", String(target.includeUntracked));
	}
}
