import { describe, expect, test } from "bun:test";
import {
	assertSealedPilotRegistration,
	createSealedPilotRegistration,
	decideValuePilot,
	hashText,
	parseStrictJson,
	sanitizeProjectIntelligenceValuePilot,
} from "./project-intelligence-value-pilot-contract";

const HASH = `sha256:${"a".repeat(64)}`;
const SHA = "b".repeat(40);

describe("project-intelligence value pilot evidence contract", () => {
	test("gives safety and catalog reliability failures precedence over incomplete evidence", () => {
		expect(
			decideValuePilot({
				safetyFailureCount: 1,
				catalogReliabilityFailureCount: 0,
				evidenceComplete: false,
				hardGates: { evidence: false },
				valueGates: { value: false },
			}),
		).toEqual({ decision: "NO-GO", reasonCodes: ["safety_incident"] });
	});

	test("rejects duplicate JSON keys before parsing", () => {
		expect(() => parseStrictJson('{"pilotId":"a","pilotId":"b"}')).toThrow(
			"Duplicate JSON key: pilotId",
		);
	});

	test("does not accept a draft registration as decision evidence", () => {
		expect(() =>
			assertSealedPilotRegistration({
				schemaVersion: "project-intelligence-value-pilot-registration-v2",
				protocolVersion: 1,
				status: "DRAFT",
				pilotId: "value-pilot-v1",
			}),
		).toThrow("SEALED");
	});

	test("rejects placeholder or structurally incomplete sealed registrations", () => {
		const registration = sealedRegistration();
		expect(() => assertSealedPilotRegistration(registration)).not.toThrow();

		registration.approvals.pilotOwner = "UNASSIGNED";
		expect(() => assertSealedPilotRegistration(registration)).toThrow(
			"assigned approver",
		);

		registration.approvals.pilotOwner = "pilot-owner";
		registration.fingerprints.route = `sha256:${"0".repeat(64)}`;
		expect(() => assertSealedPilotRegistration(registration)).toThrow(
			"zero placeholder",
		);

		registration.fingerprints.route = HASH;
		Object.assign(registration, { unreviewedOverride: true });
		expect(() => assertSealedPilotRegistration(registration)).toThrow(
			"forbidden field",
		);
	});

	test("constructs the fixed sealed schedule without accepting placeholders", () => {
		const registration = createSealedPilotRegistration(
			sealedRegistration(),
		);
		expect(registration).toMatchObject({ status: "SEALED" });
		expect(registration.schedule.pairs).toHaveLength(10);
		expect(registration.schedule.pairs[0]).toEqual({
			taskId: "p01",
			order: ["baseline", "catalog"],
		});

		expect(() =>
			createSealedPilotRegistration({
				...sealedRegistration(),
				approvals: { pilotOwner: "UNASSIGNED" },
			}),
		).toThrow("assigned approver");
		expect(() =>
			createSealedPilotRegistration({
				...sealedRegistration(),
				pilotId: "value-pilot-draft",
			}),
		).toThrow("DRAFT pilot ID");
	});

	test("sanitizes a complete GO report without retaining paths or internal IDs", () => {
		const registrationText = '{"registration":"sealed"}';
		const raw = completeRawReport(hashText(registrationText));
		const output = sanitizeProjectIntelligenceValuePilot({
			rawText: JSON.stringify(raw),
			preRegistrationHash: hashText(registrationText),
		});
		expect(output.decision).toBe("GO");
		expect(JSON.stringify(output)).not.toContain("/private/pilot-worktree");
		expect(JSON.stringify(output)).not.toContain("internal-run-id");
		expect(output.aggregate.hardGates.catalogExactlyOnceBeforeExploration).toBe(true);
	});

	test("fails closed for unknown nested fields and a manually changed decision", () => {
		const registrationHash = hashText('{"registration":"sealed"}');
		const raw = completeRawReport(registrationHash);
		(raw.attempts[0].baseline.measurement as Record<string, unknown>).surplus = true;
		expect(() =>
			sanitizeProjectIntelligenceValuePilot({
				rawText: JSON.stringify(raw),
				preRegistrationHash: registrationHash,
			}),
		).toThrow("forbidden field");
		raw.attempts[0].baseline.measurement = measurement("baseline");
		raw.decision = "NO-GO";
		expect(() =>
			sanitizeProjectIntelligenceValuePilot({
				rawText: JSON.stringify(raw),
				preRegistrationHash: registrationHash,
			}),
		).toThrow("does not match the recomputed decision");
	});

	test("rejects a claimed shared task prompt whose arm evidence disagrees", () => {
		const preRegistrationHash = hashText('{"registration":"sealed"}');
		const raw = completeRawReport(preRegistrationHash);
		raw.attempts[0].catalog.taskPromptFingerprint = `sha256:${"c".repeat(64)}`;

		expect(() =>
			sanitizeProjectIntelligenceValuePilot({
				rawText: JSON.stringify(raw),
				preRegistrationHash,
			}),
		).toThrow("same task prompt");
	});

	test("recomputes incomplete evidence when cleanup controls are not proven", () => {
		const preRegistrationHash = hashText('{"registration":"sealed"}');
		const raw = completeRawReport(preRegistrationHash);
		raw.controls.mcpDisconnected = false;
		raw.decision = "INSUFFICIENT_EVIDENCE";
		raw.decisionReasonCodes = ["mcpDisconnected"];

		const sanitized = sanitizeProjectIntelligenceValuePilot({
			rawText: JSON.stringify(raw),
			preRegistrationHash,
		});

		expect(sanitized.decision).toBe("INSUFFICIENT_EVIDENCE");
		expect(sanitized.aggregate.hardGates.mcpDisconnected).toBe(false);
	});
});

function completeRawReport(preRegistrationHash: string) {
	const taskSet = Array.from({ length: 10 }, (_, index) => ({
		id: taskId(index),
		title: "Task",
		description: "Task description",
		objective: "Task objective",
		acceptanceCriteria: "Task acceptance",
		promptDigest: HASH,
		evaluatorProfileId: `profile-${index + 1}`,
	}));
	const attempts = taskSet.map((task, index) => ({
		pairId: task.id,
		attemptNumber: 1,
		executionOrder:
			index % 2 === 0 ? (["baseline", "catalog"] as const) : (["catalog", "baseline"] as const),
		promptDigest: HASH,
		baseline: arm("baseline"),
		catalog: arm("catalog"),
		classification: "valid",
		classificationReasonCodes: [],
		controls: {
			sameBaseRef: true,
			sameTaskPrompt: true,
			sameRoute: true,
			independentWorktrees: true,
		},
	}));
	return {
		schemaVersion: "project-intelligence-value-paired-pilot-v2",
		pilotId: "value-pilot-v1",
		protocolVersion: 1,
		generatedAt: "2026-08-31T00:00:00.000Z",
		decision: "GO",
		decisionReasonCodes: [] as string[],
		preRegistrationHash,
		preflightCanaryHash: HASH,
		preflightEvidenceHash: HASH,
		controls: {
			repositoryId: "internal-repository-id",
			repositoryRoot: "/private/target",
			targetCommit: SHA,
			consumerCommit: SHA,
			producerCommit: SHA,
			consumerDirty: false,
			producerDirty: false,
			consumerDiffHash: HASH,
			mcpServerId: "internal-mcp-id",
			dedicatedDatabase: true,
			dedicatedProducerDatabase: true,
			databasePath: "/private/consumer.sqlite",
			producerDatabasePath: "/private/producer.sqlite",
			featureFlagRestoredToOff: true,
			mcpDisconnected: true,
			activePilotRunCount: 0,
			routeFingerprint: HASH,
			settingsFingerprint: HASH,
			promptContractFingerprint: HASH,
			toolManifestFingerprint: HASH,
			evaluatorSetFingerprint: HASH,
		},
		taskSet,
		attempts,
		validPairs: taskSet.map((task) => task.id),
		aggregate: {},
		stopReasonCodes: [],
	};
}

function arm(mode: "baseline" | "catalog") {
	return {
		taskId: "internal-task-id",
		runId: "internal-run-id",
		status: "completed",
		baseRef: SHA,
		worktreePath: "/private/pilot-worktree",
		measurement: measurement(mode),
		evaluation: {
			profileId: "profile-1",
			profileFingerprint: HASH,
			passed: true,
			verificationPassed: true,
			commands: [
				{
					id: "typecheck",
					exitCode: 0,
					durationMs: 1,
					outputDigest: HASH,
					outputBytes: 0,
					timedOut: false,
				},
			],
			beforeDiffDigest: HASH,
			afterDiffDigest: HASH,
			evaluatorMutatedWorktree: false,
		},
		route: {},
		taskPromptFingerprint: HASH,
		systemPromptFingerprint: HASH,
	};
}

function measurement(mode: "baseline" | "catalog") {
	return {
		runId: "internal-run-id",
		taskId: "internal-task-id",
		repositoryId: "internal-repository-id",
		mode,
		generationId: null,
		preparationDurationMs: null,
		preparationReused: null,
		preparationPollCount: null,
		fallbackReason: null,
		catalogAvailable: mode === "catalog",
		catalogCalled: mode === "catalog",
		catalogCallCount: mode === "catalog" ? 1 : 0,
		catalogFailureCount: 0,
		catalogResponseBytes: 0,
		catalogFileCount: 0,
		catalogTestCount: 0,
		catalogVerificationCount: 0,
		broadExplorationCallsBeforeCatalog: 0,
		catalogCalledBeforeBroadExploration: mode === "catalog" ? true : null,
		listDirCallsBeforeMutation: mode === "catalog" ? 5 : 10,
		searchCallsBeforeMutation: 0,
		readFileCallsBeforeMutation: 0,
		uniqueFilesReadBeforeMutation: 0,
		totalInputTokens: 1_000,
		totalCachedInputTokens: 0,
		preMutationInputTokens: mode === "catalog" ? 700 : 1_000,
		preMutationCachedInputTokens: 0,
		preMutationNonCachedInputTokens: mode === "catalog" ? 700 : 1_000,
		usageMode: "measured",
		timeToFirstMutationMs: 1,
		taskCompleted: true,
		verificationPassed: true,
		replanCount: 0,
		warnings: [],
	};
}

function taskId(index: number) {
	return `p${String(index + 1).padStart(2, "0")}`;
}

function sealedRegistration() {
	return {
		schemaVersion: "project-intelligence-value-pilot-registration-v2",
		protocolVersion: 1,
		status: "SEALED",
		pilotId: "value-pilot-v1",
		commits: { producer: SHA, consumer: SHA, target: SHA },
		fingerprints: {
			taskSet: HASH,
			evaluatorSet: HASH,
			route: HASH,
			settings: HASH,
			promptContract: HASH,
			toolManifest: HASH,
		},
		schedule: {
			cooldownSeconds: 30,
			maxAttemptsPerTask: 2,
			maxPairAttempts: 14,
			pairs: Array.from({ length: 10 }, (_, index) => ({
				taskId: taskId(index),
				order:
					index % 2 === 0
						? (["baseline", "catalog"] as const)
						: (["catalog", "baseline"] as const),
			})),
		},
		retention: { rawEvidencePolicy: "LOCAL_OWNER_RETAINED" as const },
		approvals: { pilotOwner: "pilot-owner" },
	};
}
