import { createHash } from "node:crypto";
import {
	armValue,
	array,
	assertKeys,
	assertSafeCommittedValue,
	assertTaskSchedule,
	boolean,
	classificationValue,
	code,
	DuplicateKeyJsonParser,
	explorationCalls,
	failedGateCodes,
	gitSha,
	integer,
	isComparableAttempt,
	median,
	nonEmptyText,
	nonNegativeInteger,
	nullableNonNegativeInteger,
	object,
	positiveInteger,
	reduction,
	safePilotId,
	sameStringSet,
	sha,
	stringArray,
	taskId,
} from "./project-intelligence-value-pilot-validation";

export type ValuePilotDecision = "GO" | "NO-GO" | "INSUFFICIENT_EVIDENCE";

export type ValuePilotDecisionInput = {
	safetyFailureCount: number;
	catalogReliabilityFailureCount: number;
	evidenceComplete: boolean;
	hardGates: Record<string, boolean>;
	valueGates: Record<string, boolean>;
};

export function decideValuePilot(input: ValuePilotDecisionInput): {
	decision: ValuePilotDecision;
	reasonCodes: string[];
} {
	if (
		input.safetyFailureCount > 0 ||
		input.catalogReliabilityFailureCount > 0
	) {
		return {
			decision: "NO-GO",
			reasonCodes: [
				...(input.safetyFailureCount > 0 ? ["safety_incident"] : []),
				...(input.catalogReliabilityFailureCount > 0
					? ["catalog_reliability_failure"]
					: []),
			],
		};
	}
	if (!input.evidenceComplete) {
		return {
			decision: "INSUFFICIENT_EVIDENCE",
			reasonCodes: failedGateCodes(input.hardGates),
		};
	}
	const failed = [
		...failedGateCodes(input.hardGates),
		...failedGateCodes(input.valueGates),
	];
	return failed.length === 0
		? { decision: "GO", reasonCodes: [] }
		: { decision: "NO-GO", reasonCodes: failed };
}

export function hashText(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Reject duplicate object keys before JSON.parse would silently overwrite one. */
export function parseStrictJson(text: string): unknown {
	const parser = new DuplicateKeyJsonParser(text);
	parser.assertDocument();
	return JSON.parse(text);
}

/** The result verifier only accepts the immutable registration form. */
export function assertSealedPilotRegistration(value: unknown): void {
	const registration = object(value, "pilot registration");
	if (
		registration.schemaVersion !==
			"project-intelligence-value-pilot-registration-v2" ||
		registration.protocolVersion !== 1 ||
		registration.status !== "SEALED"
	) {
		throw new Error(
			"Result verification requires a SEALED pilot registration.",
		);
	}
	assertKeys(
		registration,
		[
			"schemaVersion",
			"protocolVersion",
			"status",
			"pilotId",
			"commits",
			"fingerprints",
			"schedule",
			"retention",
			"approvals",
		],
		"pilot registration",
	);
	const pilotId = safePilotId(registration.pilotId);
	if (/(?:^|[._-])draft(?:[._-]|$)/i.test(pilotId)) {
		throw new Error("A SEALED pilot registration cannot use a DRAFT pilot ID.");
	}
	assertRegistrationCommits(
		object(registration.commits, "registration commits"),
	);
	assertRegistrationFingerprints(
		object(registration.fingerprints, "registration fingerprints"),
	);
	assertRegistrationSchedule(
		object(registration.schedule, "registration schedule"),
	);
	assertRegistrationRetention(
		object(registration.retention, "registration retention"),
	);
	assertRegistrationApprovals(
		object(registration.approvals, "registration approvals"),
	);
}

export type SealedPilotRegistrationInput = {
	pilotId: string;
	commits: { producer: string; consumer: string; target: string };
	fingerprints: {
		taskSet: string;
		evaluatorSet: string;
		route: string;
		settings: string;
		promptContract: string;
		toolManifest: string;
	};
	retention: { rawEvidencePolicy: "LOCAL_OWNER_RETAINED" };
	approvals: { pilotOwner: string };
};

/**
 * Builds the only registration shape accepted by the formal pilot. The caller
 * must supply observed control values; this helper never copies the DRAFT
 * scaffold or fills missing approval / retention values.
 */
export function createSealedPilotRegistration(
	input: SealedPilotRegistrationInput,
) {
	const registration = {
		schemaVersion: "project-intelligence-value-pilot-registration-v2",
		protocolVersion: 1,
		status: "SEALED",
		pilotId: input.pilotId,
		commits: input.commits,
		fingerprints: input.fingerprints,
		schedule: {
			cooldownSeconds: 30,
			maxAttemptsPerTask: 2,
			maxPairAttempts: 14,
			pairs: Array.from({ length: 10 }, (_, index) => ({
				taskId: `p${String(index + 1).padStart(2, "0")}`,
				order:
					index % 2 === 0
						? (["baseline", "catalog"] as const)
						: (["catalog", "baseline"] as const),
			})),
		},
		retention: input.retention,
		approvals: input.approvals,
	};
	assertSealedPilotRegistration(registration);
	return registration;
}

function assertRegistrationCommits(value: Record<string, unknown>) {
	assertKeys(value, ["producer", "consumer", "target"], "registration commits");
	for (const name of ["producer", "consumer", "target"] as const) {
		gitSha(value[name], `registration commits.${name}`);
	}
}

function assertRegistrationFingerprints(value: Record<string, unknown>) {
	const names = [
		"taskSet",
		"evaluatorSet",
		"route",
		"settings",
		"promptContract",
		"toolManifest",
	];
	assertKeys(value, names, "registration fingerprints");
	for (const name of names) {
		const fingerprint = sha(value[name], `registration fingerprints.${name}`);
		if (fingerprint === `sha256:${"0".repeat(64)}`) {
			throw new Error(
				`registration fingerprints.${name} must not be a zero placeholder.`,
			);
		}
	}
}

function assertRegistrationSchedule(value: Record<string, unknown>) {
	assertKeys(
		value,
		["cooldownSeconds", "maxAttemptsPerTask", "maxPairAttempts", "pairs"],
		"registration schedule",
	);
	nonNegativeInteger(
		value.cooldownSeconds,
		"registration schedule.cooldownSeconds",
	);
	if (value.maxAttemptsPerTask !== 2 || value.maxPairAttempts !== 14) {
		throw new Error(
			"Registration schedule does not match the fixed attempt limits.",
		);
	}
	const pairs = array(value.pairs, "registration schedule.pairs");
	if (pairs.length !== 10) {
		throw new Error("Registration schedule must contain the fixed ten pairs.");
	}
	for (const [index, entry] of pairs.entries()) {
		const pair = object(entry, `registration schedule.pairs[${index}]`);
		assertKeys(
			pair,
			["taskId", "order"],
			`registration schedule.pairs[${index}]`,
		);
		const expectedTaskId = `p${String(index + 1).padStart(2, "0")}`;
		if (pair.taskId !== expectedTaskId) {
			throw new Error("Registration schedule has a non-canonical task order.");
		}
		const order = array(
			pair.order,
			`registration schedule.pairs[${index}].order`,
		);
		const expectedOrder =
			index % 2 === 0 ? ["baseline", "catalog"] : ["catalog", "baseline"];
		if (
			order.length !== 2 ||
			order[0] !== expectedOrder[0] ||
			order[1] !== expectedOrder[1]
		) {
			throw new Error(
				"Registration schedule has a non-counterbalanced arm order.",
			);
		}
	}
}

function assertRegistrationRetention(value: Record<string, unknown>) {
	assertKeys(value, ["rawEvidencePolicy"], "registration retention");
	if (value.rawEvidencePolicy !== "LOCAL_OWNER_RETAINED") {
		throw new Error(
			"registration retention.rawEvidencePolicy must be LOCAL_OWNER_RETAINED.",
		);
	}
}

function assertRegistrationApprovals(value: Record<string, unknown>) {
	const names = ["pilotOwner"];
	assertKeys(value, names, "registration approvals");
	for (const name of names) {
		const approval = nonEmptyText(
			value[name],
			`registration approvals.${name}`,
		);
		if (/^(?:UNASSIGNED|UNSET(?:_.+)?)$/i.test(approval)) {
			throw new Error(
				`registration approvals.${name} must name an assigned approver.`,
			);
		}
	}
}

export function sanitizeProjectIntelligenceValuePilot(input: {
	rawText: string;
	preRegistrationHash: string;
}) {
	const raw = object(parseStrictJson(input.rawText), "raw report");
	assertKeys(raw, RAW_TOP_LEVEL_KEYS, "raw report");
	if (raw.schemaVersion !== "project-intelligence-value-paired-pilot-v2") {
		throw new Error("Unsupported raw pilot report schema.");
	}
	if (raw.protocolVersion !== 1)
		throw new Error("Unsupported raw pilot protocol.");
	if (raw.preRegistrationHash !== input.preRegistrationHash) {
		throw new Error(
			"Raw report pre-registration hash does not match the supplied registration.",
		);
	}
	const preflightCanaryHash = sha(
		raw.preflightCanaryHash,
		"raw report preflight canary hash",
	);
	const preflightEvidenceHash = sha(
		raw.preflightEvidenceHash,
		"raw report preflight evidence hash",
	);
	const controls = sanitizeControls(object(raw.controls, "controls"));
	const attemptsRaw = array(raw.attempts, "attempts");
	const attempts = attemptsRaw.map((attempt, index) =>
		sanitizeAttempt(object(attempt, `attempts[${index}]`)),
	);
	const taskSet = array(raw.taskSet, "taskSet").map((task, index) =>
		sanitizeTask(object(task, `taskSet[${index}]`)),
	);
	assertTaskSchedule(taskSet, attempts);
	const aggregate = aggregateAttempts(attempts, controls);
	const recalculated = decideValuePilot(aggregate.decisionInput);
	if (raw.decision !== recalculated.decision) {
		throw new Error(
			"Raw report decision does not match the recomputed decision.",
		);
	}
	const rawReasonCodes = stringArray(
		raw.decisionReasonCodes,
		"decisionReasonCodes",
	);
	if (!sameStringSet(rawReasonCodes, recalculated.reasonCodes)) {
		throw new Error(
			"Raw report decision reason codes do not match the recomputed decision.",
		);
	}
	const sanitized = {
		schemaVersion: "project-intelligence-value-paired-pilot-v2",
		pilotId: safePilotId(raw.pilotId),
		protocolVersion: 1,
		decision: recalculated.decision,
		decisionReasonCodes: recalculated.reasonCodes,
		preRegistrationHash: input.preRegistrationHash,
		preflightCanaryHash,
		preflightEvidenceHash,
		rawEvidenceHash: hashText(input.rawText),
		controls,
		taskSet,
		attempts,
		validPairs: attempts
			.filter((attempt) => isComparableAttempt(attempt.classification))
			.map((attempt) => ({
				taskId: attempt.taskId,
				attemptNumber: attempt.attemptNumber,
			})),
		aggregate: aggregate.public,
		stopReasonCodes: stringArray(raw.stopReasonCodes, "stopReasonCodes"),
	};
	assertSafeCommittedValue(sanitized);
	return sanitized;
}

const RAW_TOP_LEVEL_KEYS = [
	"schemaVersion",
	"pilotId",
	"protocolVersion",
	"generatedAt",
	"decision",
	"decisionReasonCodes",
	"preRegistrationHash",
	"preflightCanaryHash",
	"preflightEvidenceHash",
	"controls",
	"taskSet",
	"attempts",
	"validPairs",
	"aggregate",
	"stopReasonCodes",
] as const;

function sanitizeControls(value: Record<string, unknown>) {
	assertKeys(
		value,
		[
			"repositoryId",
			"repositoryRoot",
			"targetCommit",
			"consumerCommit",
			"producerCommit",
			"consumerDirty",
			"producerDirty",
			"consumerDiffHash",
			"mcpServerId",
			"dedicatedDatabase",
			"dedicatedProducerDatabase",
			"databasePath",
			"producerDatabasePath",
			"featureFlagRestoredToOff",
			"mcpDisconnected",
			"activePilotRunCount",
			"routeFingerprint",
			"settingsFingerprint",
			"promptContractFingerprint",
			"toolManifestFingerprint",
			"evaluatorSetFingerprint",
		],
		"controls",
	);
	return {
		producerCommit: gitSha(value.producerCommit, "controls.producerCommit"),
		consumerCommit: gitSha(value.consumerCommit, "controls.consumerCommit"),
		targetCommit: gitSha(value.targetCommit, "controls.targetCommit"),
		cleanSources:
			value.consumerDirty === false && value.producerDirty === false,
		dedicatedDatabase: boolean(
			value.dedicatedDatabase,
			"controls.dedicatedDatabase",
		),
		dedicatedProducerDatabase: boolean(
			value.dedicatedProducerDatabase,
			"controls.dedicatedProducerDatabase",
		),
		featureFlagRestoredToOff: boolean(
			value.featureFlagRestoredToOff,
			"controls.featureFlagRestoredToOff",
		),
		mcpDisconnected: boolean(value.mcpDisconnected, "controls.mcpDisconnected"),
		activePilotRunCount: nonNegativeInteger(
			value.activePilotRunCount,
			"controls.activePilotRunCount",
		),
		routeFingerprint: sha(value.routeFingerprint, "controls.routeFingerprint"),
		settingsFingerprint: sha(
			value.settingsFingerprint,
			"controls.settingsFingerprint",
		),
		promptContractFingerprint: sha(
			value.promptContractFingerprint,
			"controls.promptContractFingerprint",
		),
		toolManifestFingerprint: sha(
			value.toolManifestFingerprint,
			"controls.toolManifestFingerprint",
		),
		evaluatorSetFingerprint: sha(
			value.evaluatorSetFingerprint,
			"controls.evaluatorSetFingerprint",
		),
	};
}

export function sanitizeTask(value: Record<string, unknown>) {
	assertKeys(
		value,
		[
			"id",
			"title",
			"description",
			"objective",
			"acceptanceCriteria",
			"promptDigest",
			"evaluatorProfileId",
		],
		"taskSet entry",
	);
	return {
		id: taskId(value.id),
		promptDigest: sha(value.promptDigest, "taskSet.promptDigest"),
		evaluatorProfileId: code(
			value.evaluatorProfileId,
			"taskSet.evaluatorProfileId",
		),
	};
}

export function sanitizeAttempt(value: Record<string, unknown>) {
	assertKeys(
		value,
		[
			"pairId",
			"attemptNumber",
			"executionOrder",
			"promptDigest",
			"baseline",
			"catalog",
			"classification",
			"classificationReasonCodes",
			"controls",
		],
		"attempt",
	);
	const task = taskId(value.pairId);
	const executionOrder = array(
		value.executionOrder,
		"attempt.executionOrder",
	).map((arm) => armValue(arm, "attempt.executionOrder"));
	if (executionOrder.length !== 2 || executionOrder[0] === executionOrder[1]) {
		throw new Error(
			"Attempt execution order must contain one baseline and one catalog arm.",
		);
	}
	const classification = classificationValue(value.classification);
	const controls = object(value.controls, "attempt.controls");
	assertKeys(
		controls,
		["sameBaseRef", "sameTaskPrompt", "sameRoute", "independentWorktrees"],
		"attempt.controls",
	);
	const promptDigest = sha(value.promptDigest, "attempt.promptDigest");
	const sanitizedControls = {
		sameBaseRef: boolean(controls.sameBaseRef, "attempt.controls.sameBaseRef"),
		sameTaskPrompt: boolean(
			controls.sameTaskPrompt,
			"attempt.controls.sameTaskPrompt",
		),
		sameRoute: boolean(controls.sameRoute, "attempt.controls.sameRoute"),
		independentWorktrees: boolean(
			controls.independentWorktrees,
			"attempt.controls.independentWorktrees",
		),
	};
	const baseline = sanitizeArm(
		object(value.baseline, "attempt.baseline"),
		"baseline",
	);
	const catalog = sanitizeArm(
		object(value.catalog, "attempt.catalog"),
		"catalog",
	);
	if (
		sanitizedControls.sameTaskPrompt &&
		(baseline.taskPromptFingerprint !== promptDigest ||
			catalog.taskPromptFingerprint !== promptDigest)
	) {
		throw new Error(
			"Attempt claims the same task prompt but its arm evidence disagrees.",
		);
	}
	if (sanitizedControls.sameBaseRef && baseline.baseRef !== catalog.baseRef) {
		throw new Error(
			"Attempt claims the same base ref but its arm evidence disagrees.",
		);
	}
	return {
		taskId: task,
		attemptNumber: positiveInteger(
			value.attemptNumber,
			"attempt.attemptNumber",
		),
		executionOrder: executionOrder as [
			"baseline" | "catalog",
			"baseline" | "catalog",
		],
		promptDigest,
		classification,
		classificationReasonCodes: stringArray(
			value.classificationReasonCodes,
			"attempt.classificationReasonCodes",
		),
		controls: sanitizedControls,
		baseline,
		catalog,
	};
}

function sanitizeArm(
	value: Record<string, unknown>,
	expectedMode: "baseline" | "catalog",
) {
	assertKeys(
		value,
		[
			"taskId",
			"runId",
			"status",
			"baseRef",
			"worktreePath",
			"taskPromptFingerprint",
			"measurement",
			"evaluation",
			"route",
			"systemPromptFingerprint",
		],
		`attempt.${expectedMode}`,
	);
	const measurement = object(
		value.measurement,
		`attempt.${expectedMode}.measurement`,
	);
	assertKeys(
		measurement,
		MEASUREMENT_KEYS,
		`attempt.${expectedMode}.measurement`,
	);
	if (measurement.mode !== expectedMode) {
		throw new Error(
			`Attempt ${expectedMode} measurement mode is inconsistent.`,
		);
	}
	const evaluation =
		value.evaluation === null
			? null
			: sanitizeEvaluation(object(value.evaluation, "evaluation"));
	return {
		status: code(value.status, `attempt.${expectedMode}.status`),
		baseRef: gitSha(value.baseRef, `attempt.${expectedMode}.baseRef`),
		taskPromptFingerprint: sha(
			value.taskPromptFingerprint,
			`attempt.${expectedMode}.taskPromptFingerprint`,
		),
		systemPromptFingerprint: sha(
			value.systemPromptFingerprint,
			`attempt.${expectedMode}.systemPromptFingerprint`,
		),
		measurement: {
			mode: expectedMode,
			catalogCallCount: nonNegativeInteger(
				measurement.catalogCallCount,
				"catalogCallCount",
			),
			catalogCalledBeforeBroadExploration:
				measurement.catalogCalledBeforeBroadExploration === true,
			catalogFailureCount: nonNegativeInteger(
				measurement.catalogFailureCount,
				"catalogFailureCount",
			),
			fallbackReason:
				typeof measurement.fallbackReason === "string"
					? code(measurement.fallbackReason, "fallbackReason")
					: null,
			listDirCallsBeforeMutation: nonNegativeInteger(
				measurement.listDirCallsBeforeMutation,
				"listDirCallsBeforeMutation",
			),
			searchCallsBeforeMutation: nonNegativeInteger(
				measurement.searchCallsBeforeMutation,
				"searchCallsBeforeMutation",
			),
			readFileCallsBeforeMutation: nonNegativeInteger(
				measurement.readFileCallsBeforeMutation,
				"readFileCallsBeforeMutation",
			),
			preMutationNonCachedInputTokens: nullableNonNegativeInteger(
				measurement.preMutationNonCachedInputTokens,
				"preMutationNonCachedInputTokens",
			),
			usageMode: code(measurement.usageMode, "usageMode"),
			taskCompleted: boolean(measurement.taskCompleted, "taskCompleted"),
			replanCount: nonNegativeInteger(measurement.replanCount, "replanCount"),
			warnings: stringArray(measurement.warnings, "measurement.warnings"),
		},
		evaluation,
	};
}

const MEASUREMENT_KEYS = [
	"runId",
	"taskId",
	"repositoryId",
	"mode",
	"generationId",
	"preparationDurationMs",
	"preparationReused",
	"preparationPollCount",
	"fallbackReason",
	"catalogAvailable",
	"catalogCalled",
	"catalogCallCount",
	"catalogFailureCount",
	"catalogResponseBytes",
	"catalogFileCount",
	"catalogTestCount",
	"catalogVerificationCount",
	"broadExplorationCallsBeforeCatalog",
	"catalogCalledBeforeBroadExploration",
	"listDirCallsBeforeMutation",
	"searchCallsBeforeMutation",
	"readFileCallsBeforeMutation",
	"uniqueFilesReadBeforeMutation",
	"totalInputTokens",
	"totalCachedInputTokens",
	"preMutationInputTokens",
	"preMutationCachedInputTokens",
	"preMutationNonCachedInputTokens",
	"usageMode",
	"timeToFirstMutationMs",
	"taskCompleted",
	"verificationPassed",
	"replanCount",
	"warnings",
] as const;

function sanitizeEvaluation(value: Record<string, unknown>) {
	assertKeys(
		value,
		[
			"profileId",
			"profileFingerprint",
			"passed",
			"verificationPassed",
			"commands",
			"beforeDiffDigest",
			"afterDiffDigest",
			"evaluatorMutatedWorktree",
		],
		"evaluation",
	);
	const commands = array(value.commands, "evaluation.commands").map(
		(command, index) => {
			const item = object(command, `evaluation.commands[${index}]`);
			assertKeys(
				item,
				[
					"id",
					"exitCode",
					"durationMs",
					"outputDigest",
					"outputBytes",
					"timedOut",
				],
				"evaluation command",
			);
			return {
				id: code(item.id, "evaluation command id"),
				exitCode:
					item.exitCode === null
						? null
						: integer(item.exitCode, "evaluation exit code"),
				durationMs: nonNegativeInteger(item.durationMs, "evaluation duration"),
				outputDigest: sha(item.outputDigest, "evaluation output digest"),
				outputBytes: nonNegativeInteger(
					item.outputBytes,
					"evaluation output bytes",
				),
				timedOut: boolean(item.timedOut, "evaluation timedOut"),
			};
		},
	);
	return {
		profileId: code(value.profileId, "evaluation profile"),
		profileFingerprint: sha(
			value.profileFingerprint,
			"evaluation profile fingerprint",
		),
		passed: boolean(value.passed, "evaluation passed"),
		verificationPassed: boolean(
			value.verificationPassed,
			"evaluation verificationPassed",
		),
		commands,
		evaluatorMutatedWorktree: boolean(
			value.evaluatorMutatedWorktree,
			"evaluatorMutatedWorktree",
		),
	};
}

function aggregateAttempts(
	attempts: ReturnType<typeof sanitizeAttempt>[],
	controls: ReturnType<typeof sanitizeControls>,
) {
	const valid = attempts.filter((attempt) =>
		isComparableAttempt(attempt.classification),
	);
	const safetyFailureCount = attempts.filter(
		(attempt) => attempt.classification === "safety_failure",
	).length;
	const catalogReliabilityFailureCount = attempts.filter(
		(attempt) => attempt.classification === "catalog_reliability_failure",
	).length;
	const controlsPassed = valid.every((attempt) =>
		Object.values(attempt.controls).every(Boolean),
	);
	const catalogExactlyOnce = valid.every(
		(attempt) =>
			attempt.catalog.measurement.catalogCallCount === 1 &&
			attempt.catalog.measurement.catalogCalledBeforeBroadExploration,
	);
	const evaluationsComplete = valid.every(
		(attempt) =>
			attempt.baseline.evaluation !== null &&
			attempt.catalog.evaluation !== null &&
			!attempt.baseline.evaluation.evaluatorMutatedWorktree &&
			!attempt.catalog.evaluation.evaluatorMutatedWorktree,
	);
	const telemetryComplete = valid.every(
		(attempt) =>
			attempt.baseline.measurement.usageMode === "measured" &&
			attempt.catalog.measurement.usageMode === "measured" &&
			attempt.baseline.measurement.preMutationNonCachedInputTokens !== null &&
			attempt.catalog.measurement.preMutationNonCachedInputTokens !== null,
	);
	const baselineExploration = valid.map(explorationCalls("baseline"));
	const catalogExploration = valid.map(explorationCalls("catalog"));
	const baselineTokens = valid.map(
		(attempt) =>
			attempt.baseline.measurement.preMutationNonCachedInputTokens as number,
	);
	const catalogTokens = valid.map(
		(attempt) =>
			attempt.catalog.measurement.preMutationNonCachedInputTokens as number,
	);
	const completionRegressionCount = valid.filter(
		(attempt) =>
			attempt.baseline.evaluation?.passed &&
			!attempt.catalog.evaluation?.passed,
	).length;
	const verificationRegressionCount = valid.filter(
		(attempt) =>
			attempt.baseline.evaluation?.verificationPassed &&
			!attempt.catalog.evaluation?.verificationPassed,
	).length;
	const baselineCompletion = valid.filter(
		(attempt) => attempt.baseline.evaluation?.passed,
	).length;
	const catalogCompletion = valid.filter(
		(attempt) => attempt.catalog.evaluation?.passed,
	).length;
	const baselineVerification = valid.filter(
		(attempt) => attempt.baseline.evaluation?.verificationPassed,
	).length;
	const catalogVerification = valid.filter(
		(attempt) => attempt.catalog.evaluation?.verificationPassed,
	).length;
	const explorationReduction = reduction(
		median(baselineExploration),
		median(catalogExploration),
	);
	const tokenReduction = reduction(
		median(baselineTokens),
		median(catalogTokens),
	);
	const hardGates = {
		minimumTenPairs: valid.length === 10,
		attemptRetention: attempts.length >= valid.length,
		pairedControls: controlsPassed,
		consumerSourceClean: controls.cleanSources,
		producerSourceClean: controls.cleanSources,
		databaseIsolation: controls.dedicatedDatabase,
		producerDatabaseIsolation: controls.dedicatedProducerDatabase,
		featureFlagRestoredToOff: controls.featureFlagRestoredToOff,
		mcpDisconnected: controls.mcpDisconnected,
		activePilotRunsDrained: controls.activePilotRunCount === 0,
		catalogExactlyOnceBeforeExploration: catalogExactlyOnce,
		zeroCatalogReliabilityFailures: catalogReliabilityFailureCount === 0,
		zeroUnsafeIncidents: safetyFailureCount === 0,
		zeroCatalogFailurePropagation: valid.every(
			(attempt) =>
				attempt.catalog.measurement.catalogFailureCount === 0 ||
				attempt.catalog.measurement.taskCompleted,
		),
		independentEvaluationComplete: evaluationsComplete,
		measuredUsageComplete: telemetryComplete,
	};
	const catalogReplanMedian = median(
		valid.map((attempt) => attempt.catalog.measurement.replanCount),
	);
	const baselineReplanMedian = median(
		valid.map((attempt) => attempt.baseline.measurement.replanCount),
	);
	const valueGates = {
		explorationReduction:
			explorationReduction !== null && explorationReduction >= 0.2,
		preMutationNonCachedInputTokenReduction:
			tokenReduction !== null && tokenReduction >= 0.15,
		completionNonRegression:
			catalogCompletion >= baselineCompletion &&
			completionRegressionCount === 0,
		verificationNonRegression:
			catalogVerification >= baselineVerification &&
			verificationRegressionCount === 0,
		noReplanIncrease:
			catalogReplanMedian !== null &&
			baselineReplanMedian !== null &&
			catalogReplanMedian <= baselineReplanMedian,
	};
	return {
		decisionInput: {
			safetyFailureCount,
			catalogReliabilityFailureCount,
			evidenceComplete: [
				hardGates.minimumTenPairs,
				hardGates.attemptRetention,
				hardGates.pairedControls,
				hardGates.consumerSourceClean,
				hardGates.producerSourceClean,
				hardGates.databaseIsolation,
				hardGates.producerDatabaseIsolation,
				hardGates.featureFlagRestoredToOff,
				hardGates.mcpDisconnected,
				hardGates.activePilotRunsDrained,
				hardGates.catalogExactlyOnceBeforeExploration,
				hardGates.zeroCatalogFailurePropagation,
				hardGates.independentEvaluationComplete,
				hardGates.measuredUsageComplete,
			].every(Boolean),
			hardGates,
			valueGates,
		},
		public: {
			validPairCount: valid.length,
			attemptCount: attempts.length,
			pairedReductions: {
				exploratoryToolCalls: explorationReduction,
				preMutationNonCachedInputTokens: tokenReduction,
			},
			qualityGuards: {
				baselineCompletion,
				catalogCompletion,
				baselineVerification,
				catalogVerification,
				completionRegressionCount,
				verificationRegressionCount,
			},
			safetyIncidents: { safetyFailureCount, catalogReliabilityFailureCount },
			hardGates,
			valueGates,
		},
	};
}
