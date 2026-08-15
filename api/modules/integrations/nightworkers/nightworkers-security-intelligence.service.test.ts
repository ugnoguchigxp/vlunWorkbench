import { describe, expect, it, vi } from "vitest";
import {
	authorizationShadowObservedFixture,
	dependencyNoFindingsObservedFixture,
} from "../../../../shared/fixtures/security-intelligence-assessment-v1";
import type { SecurityIntelligenceAssessmentV1 } from "../../../../shared/schemas/security-intelligence-assessment.schema";
import {
	deriveSecurityIntelligenceAssessmentRef,
	parseSecurityIntelligenceAssessmentV1,
} from "../../../../shared/security-intelligence-assessment-contract";
import { NightworkersSecurityIntelligenceService } from "./nightworkers-security-intelligence.service";
import type { NightworkersSecurityIntelligenceTelemetry } from "./nightworkers-security-intelligence-telemetry";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SCAN_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";
const COMPLETED_AT = new Date("2026-08-15T01:00:00.000Z");
const digest = (character: string): string =>
	`sha256:${character.repeat(64)}`;
const target = {
	kind: "diff" as const,
	sourceRevision: "b".repeat(40),
	targetDigest: digest("b"),
	baseRevision: "a".repeat(40),
	headRevision: "b".repeat(40),
	baseTargetDigest: digest("a"),
};

const client = {
	id: "integration-client-1",
	ownerUserId: OWNER_ID,
	scopes: ["nightworkers:security-scan:read"],
	allowedRoots: [],
	rateLimitPolicy: { limit: 60, windowMs: 60_000 },
};

describe("NightworkersSecurityIntelligenceService", () => {
	it("returns a deterministic dependency bundle with authorization explicitly disabled", async () => {
		const dependency = rebind(dependencyNoFindingsObservedFixture);
		const telemetry = vi.fn(
			(_observation: NightworkersSecurityIntelligenceTelemetry) => undefined,
		);
		const setup = createService({ dependency, telemetry });

		const first = await setup.service.assessment(client as never, SCAN_ID);
		const second = await setup.service.assessment(client as never, SCAN_ID);

		expect(first).toEqual(second);
		expect(first).toMatchObject({
			projectRef: `project:${PROJECT_ID}`,
			scanRunRef: `scan-run:${SCAN_ID}`,
			authorizationShadow: {
				status: "disabled",
				reasonCode: "authorization_shadow_disabled",
			},
			limitationCodes: ["authorization_shadow_disabled"],
		});
		expect(setup.dependencyBuilder).toHaveBeenCalledWith({
			scanRunId: SCAN_ID,
			expectedProjectId: PROJECT_ID,
			ownerUserId: OWNER_ID,
			generatedAt: COMPLETED_AT,
		});
		expect(telemetry).toHaveBeenCalledTimes(2);
		expect(telemetry).toHaveBeenCalledWith(
			expect.objectContaining({
				authorizationStatus: "disabled",
				dependencyOutcome: dependency.outcome,
				evidenceRefCount: dependency.evidenceRefs.length,
			}),
		);
	});

	it("reports in-progress scans as retryable without building an assessment", async () => {
		const setup = createService({
			dependency: rebind(dependencyNoFindingsObservedFixture),
			scan: { status: "running", completedAt: null },
		});

		await expect(
			setup.service.assessment(client as never, SCAN_ID),
		).rejects.toMatchObject({
			code: "assessment_not_ready",
			status: 409,
			retryable: true,
		});
		expect(setup.dependencyBuilder).not.toHaveBeenCalled();
	});

	it("fails closed when the resource is not bound and allowlisted for the client", async () => {
		const dependency = rebind(dependencyNoFindingsObservedFixture);
		for (const setup of [
			createService({ dependency, binding: null }),
			createService({ dependency, allowedProjectIds: [] }),
			createService({ dependency, binding: { ownerUserId: "another-owner" } }),
		]) {
			await expect(
				setup.service.assessment(client as never, SCAN_ID),
			).rejects.toMatchObject({ code: "scan_not_found", status: 404 });
			expect(setup.dependencyBuilder).not.toHaveBeenCalled();
		}
	});

	it("maps dependency generation failures to a privacy-safe unavailable error", async () => {
		const dependencyBuilder = vi.fn(async () => {
			throw new Error("read /Users/private/repository/package-lock.json");
		});
		const setup = createService({ dependencyBuilder });

		await expect(
			setup.service.assessment(client as never, SCAN_ID),
		).rejects.toEqual(
				expect.objectContaining({
					code: "assessment_unavailable",
					message:
						"Security Intelligence assessment is unavailable for this scan.",
				status: 422,
			}),
		);
	});

	it("degrades an absent or failed optional authorization provider explicitly", async () => {
		const dependency = rebind(dependencyNoFindingsObservedFixture);
		for (const authorizationAssessmentProvider of [
			vi.fn(async () => null),
			vi.fn(async () => {
				throw new Error("shadow store unavailable");
			}),
		]) {
			const setup = createService({
				dependency,
				authorizationShadowEnabled: true,
				authorizationAssessmentProvider,
			});
			const result = await setup.service.assessment(client as never, SCAN_ID);
			expect(result.authorizationShadow).toEqual({
				status: "unavailable",
				reasonCode: "authorization_shadow_unavailable",
			});
			expect(result.limitationCodes).toEqual([
				"authorization_shadow_unavailable",
			]);
		}
	});

	it("accepts only an authorization assessment bound to the exact diff target", async () => {
		const dependency = rebind(dependencyNoFindingsObservedFixture);
		const available = createService({
			dependency,
			authorizationShadowEnabled: true,
			authorizationAssessmentProvider: vi.fn(async () =>
				rebind(authorizationShadowObservedFixture),
			),
		});
		expect(
			(await available.service.assessment(client as never, SCAN_ID))
				.authorizationShadow.status,
		).toBe("available");

		const mismatched = rebind(authorizationShadowObservedFixture);
		mismatched.target = { ...mismatched.target, baseRevision: "c".repeat(40) };
		mismatched.assessmentRef = deriveSecurityIntelligenceAssessmentRef(mismatched);
		const rejected = createService({
			dependency,
			authorizationShadowEnabled: true,
			authorizationAssessmentProvider: vi.fn(async () => mismatched),
		});
		await expect(
			rejected.service.assessment(client as never, SCAN_ID),
		).rejects.toMatchObject({ code: "assessment_unavailable", status: 422 });
	});
});

function createService(options: {
	dependency?: SecurityIntelligenceAssessmentV1;
	dependencyBuilder?: ReturnType<typeof vi.fn>;
	binding?: null | Partial<ReturnType<typeof binding>>;
	scan?: Partial<ReturnType<typeof scan>>;
	allowedProjectIds?: string[];
	authorizationShadowEnabled?: boolean;
	authorizationAssessmentProvider?: ReturnType<typeof vi.fn>;
	telemetry?: (observation: NightworkersSecurityIntelligenceTelemetry) => void;
}) {
	const dependencyBuilder =
		options.dependencyBuilder ?? vi.fn(async () => options.dependency);
	const resourceBinding =
		options.binding === null ? null : { ...binding(), ...options.binding };
	const scanRun = { ...scan(), ...options.scan };
	const service = new NightworkersSecurityIntelligenceService({
		db: {} as never,
		env: {
			nightworkersSecurityIntelligenceAllowedProjectIds:
				options.allowedProjectIds ?? [PROJECT_ID],
			nightworkersSecurityIntelligenceAuthorizationShadowEnabled:
				options.authorizationShadowEnabled ?? false,
		},
		integrationRepository: {
			findResourceBinding: vi.fn(async () => resourceBinding),
		} as never,
		scanRepository: {
			findById: vi.fn(async () => scanRun),
		} as never,
		dependencyAssessmentBuilder: dependencyBuilder as never,
		authorizationAssessmentProvider:
			options.authorizationAssessmentProvider as never,
		telemetry: options.telemetry,
	});
	return { service, dependencyBuilder };
}

function binding() {
	return {
		id: "binding-1",
		integrationClientId: client.id,
		resourceType: "scan_run",
		resourceId: SCAN_ID,
		projectId: PROJECT_ID,
		ownerUserId: OWNER_ID,
		createdAt: new Date("2026-08-15T00:00:00.000Z"),
	};
}

function scan() {
	return {
		id: SCAN_ID,
		projectId: PROJECT_ID,
		profile: "diff-basic-security",
		status: "completed",
		startedAt: new Date("2026-08-15T00:30:00.000Z"),
		completedAt: COMPLETED_AT as Date | null,
		createdByUserId: OWNER_ID,
		summary: null,
		lastEventSeq: 1,
		metadata: {},
		createdAt: new Date("2026-08-15T00:29:00.000Z"),
		updatedAt: COMPLETED_AT,
	};
}

function rebind(
	input: SecurityIntelligenceAssessmentV1,
): SecurityIntelligenceAssessmentV1 {
	const assessment = structuredClone(input);
	assessment.projectRef = `project:${PROJECT_ID}`;
	assessment.source.scanRunRef = `scan-run:${SCAN_ID}`;
	assessment.target = target;
	assessment.evidenceRefs = assessment.evidenceRefs.map((evidence) => ({
		...evidence,
		scanRunRef: assessment.source.scanRunRef,
		targetDigest:
			evidence.targetRole === "base_target"
				? target.baseTargetDigest
				: target.targetDigest,
	}));
	assessment.assessmentRef = deriveSecurityIntelligenceAssessmentRef(assessment);
	return parseSecurityIntelligenceAssessmentV1(assessment);
}
