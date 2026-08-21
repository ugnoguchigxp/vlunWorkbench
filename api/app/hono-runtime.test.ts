import { describe, expect, it } from "vitest";
import { isRuntimeShape } from "./hono-runtime";

function createRuntimeShape(projectArtifactCleanupRunner: unknown) {
	return {
		env: {},
		dbConnection: {},
		llmProvider: {},
		embeddingProvider: {},
		webSearchProviderName: null,
		webSearchUnavailableMessage: null,
		sourceRepository: {},
		retriever: {},
		evidenceCollector: {},
		authService: {},
		settingsRepository: {
			getSystemContextForUser() {},
			updateSystemContext() {},
		},
		llmSettingsRepository: {},
		llmRouter: {},
		wikiBlobSyncer: null,
		scanSupervisor: {},
		webProcessCapacity: {},
		scanReportRunner: {},
		scanDiagnosticRunner: {},
		scanImprovementRequestRunner: {},
		activeAssessmentRunner: {},
		businessLogicRunner: {},
		integrationClientService: {},
		projectArtifactCleanupRunner,
		workspaceTargetGrantJanitor: { stop() {} },
		runtimeBundleLeaseJanitor: { stop() {} },
		dynamicBundleLeaseJanitor: { stop() {} },
		agenticSearchService: { run() {} },
	};
}

describe("isRuntimeShape", () => {
	it("accepts the stable queued cleanup contract without removeManifest", () => {
		expect(isRuntimeShape(createRuntimeShape({ recover() {}, enqueue() {} }))).toBe(
			true,
		);
	});

	it("rejects a cached runtime that cannot enqueue cleanup work", () => {
		expect(
			isRuntimeShape(
				createRuntimeShape({
					recover() {},
				}),
			),
		).toBe(false);
	});
});
