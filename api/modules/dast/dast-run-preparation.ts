import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { projects } from "../../db/schema";
import type { DastRepository } from "./dast-repository";
import type { RunDastOptions } from "./dast-runner-types";
import {
	assertDastProfileRunnable,
	getDastProfile,
	type DastProfileDefinition,
} from "./profiles";
import { validateDastTargetConfig } from "./target-validator";
import type {
	DastFailureKind,
	DastTargetValidationResult,
	ValidatedDastTarget,
} from "./types";

type PreparedDastRun =
	| {
			ok: true;
			profile: DastProfileDefinition;
			target: NonNullable<
				Awaited<ReturnType<DastRepository["getTargetConfig"]>>
			>;
			profileConfig: NonNullable<
				Awaited<ReturnType<DastRepository["getProfileConfig"]>>
			> | null;
			validation: ValidatedDastTarget;
			projectRoot: string;
	  }
	| {
			ok: false;
			failureKind: DastFailureKind;
			message: string;
			validation?: DastTargetValidationResult;
	  };

export async function prepareDastRun(params: {
	db: AppDatabase;
	repository: DastRepository;
	options: RunDastOptions;
}): Promise<PreparedDastRun> {
	const { db, repository, options } = params;
	const project =
		(await db.query.projects.findFirst({
			where: eq(projects.id, options.projectId),
		})) ?? null;
	if (!project) {
		return rejected("Project not found.");
	}
	const target = await repository.getTargetConfig(options.targetConfigId);
	if (!target || target.projectId !== options.projectId) {
		return rejected("DAST target config not found.");
	}
	const profileConfig = options.profileConfigId
		? await repository.getProfileConfig(options.profileConfigId)
		: options.useStoredProfileConfig === false
			? null
			: await repository.getProfileConfigForTarget(
					options.projectId,
					target.id,
					options.profileId,
				);
	if (profileConfig && profileConfig.projectId !== options.projectId) {
		return rejected("DAST profile config does not belong to the project.");
	}
	if (profileConfig && profileConfig.targetConfigId !== target.id) {
		return rejected(
			"DAST profile config target does not match requested target.",
		);
	}
	if (profileConfig && profileConfig.profileId !== options.profileId) {
		return rejected(
			"DAST profile config profile does not match requested profile.",
		);
	}
	const profile = getDastProfile(options.profileId);
	if (!profile) {
		return rejected(`DAST profile not found: ${options.profileId}`);
	}
	if (options.runner === "docker") {
		return rejected(
			"Built-in DAST profiles require the host runner; containerized ZAP and Nuclei run through runtime scanner profiles.",
		);
	}
	try {
		assertDastProfileRunnable({
			profileId: profile.id,
			profileEnabled: profileConfig?.enabled ?? true,
			routePaths: profileConfig?.routePathsJson ?? [],
			formSelectors: profileConfig?.formSelectorsJson ?? [],
			authContextId: options.authContextId,
		});
	} catch (error) {
		return rejected(
			error instanceof Error ? error.message : "DAST profile disabled.",
		);
	}

	const validation = await validateDastTargetConfig(target, {
		runner: options.runner,
	});
	if (!validation.ok) {
		return {
			ok: false,
			failureKind: "dast_target_rejected",
			message: validation.message,
			validation,
		};
	}
	return {
		ok: true,
		profile,
		target,
		profileConfig,
		validation,
		projectRoot: project.canonicalRepoPath ?? project.repoPath,
	};
}

function rejected(message: string): PreparedDastRun {
	return {
		ok: false,
		failureKind: "dast_target_rejected",
		message,
	};
}
