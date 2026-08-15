import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { positiveSecurityIntelligenceAssessmentFixtures } from "../shared/fixtures/security-intelligence-assessment-v1";
import { negativeSecurityIntelligenceAssessmentFixtures } from "../shared/fixtures/security-intelligence-assessment-v1-negative";
import { NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION } from "../shared/schemas/nightworkers-security-scan-integration.schema";
import {
	NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
	nightworkersSecurityIntelligenceSuccessEnvelopeSchema,
	parseNightworkersSecurityIntelligenceBundle,
} from "../shared/schemas/nightworkers-security-intelligence.schema";
import {
	SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION,
	securityIntelligenceAssessmentV1Schema,
} from "../shared/schemas/security-intelligence-assessment.schema";
import { securityIntelligenceSafeTextSchema } from "../shared/schemas/security-intelligence-assessment-components.schema";
import {
	canonicalStringifySecurityIntelligenceValue,
	parseSecurityIntelligenceAssessmentV1,
} from "../shared/security-intelligence-assessment-contract";

const repositoryRoot = path.resolve(import.meta.dir, "..");
export const securityIntelligenceBaselinePath = path.join(
	repositoryRoot,
	"spec/evidence/security-intelligence-stage-0-baseline.json",
);

const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const assessmentRefSchema = z.string().regex(/^sia:v1:[a-f0-9]{64}$/);
const fixtureNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);
const issueCodeSchema = z.string().min(1).max(200);
const negativeFixtureValidatorSchema = z.enum(["contract", "schema"]);

const fixtureSnapshotSchema = z
	.object({
		name: fixtureNameSchema,
		assessmentRef: assessmentRefSchema,
		sha256: sha256DigestSchema,
	})
	.strict();
const negativeFixtureSnapshotSchema = z
	.object({
		name: fixtureNameSchema,
		expectedIssue: issueCodeSchema,
		sha256: sha256DigestSchema,
		validator: negativeFixtureValidatorSchema,
	})
	.strict();

export const securityIntelligenceContractSnapshotSchema = z
	.object({
		contractVersion: z.literal(
			SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION,
		),
		schemaFileSha256: sha256DigestSchema,
		schemaComponentsFileSha256: sha256DigestSchema,
		canonicalizationFileSha256: sha256DigestSchema,
		fixtureSourceFileSha256: sha256DigestSchema,
		negativeFixtureSourceFileSha256: sha256DigestSchema,
		verifierFileSha256: sha256DigestSchema,
		positiveFixtureCount: z.number().int().nonnegative(),
		negativeFixtureCount: z.number().int().nonnegative(),
		fixtureSetSha256: sha256DigestSchema,
		fixtures: z.array(fixtureSnapshotSchema).min(1).max(100),
		negativeFixtures: z.array(negativeFixtureSnapshotSchema).min(1).max(100),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.positiveFixtureCount !== value.fixtures.length) {
			ctx.addIssue({
				code: "custom",
				path: ["positiveFixtureCount"],
				message: "security_intelligence:positive_fixture_count_mismatch",
			});
		}
		if (value.negativeFixtureCount !== value.negativeFixtures.length) {
			ctx.addIssue({
				code: "custom",
				path: ["negativeFixtureCount"],
				message: "security_intelligence:negative_fixture_count_mismatch",
			});
		}
		if (!isUniqueAndSorted(value.fixtures.map((fixture) => fixture.name))) {
			ctx.addIssue({
				code: "custom",
				path: ["fixtures"],
				message:
					"security_intelligence:positive_fixtures_not_unique_and_sorted",
			});
		}
		if (
			!isUniqueAndSorted(value.negativeFixtures.map((fixture) => fixture.name))
		) {
			ctx.addIssue({
				code: "custom",
				path: ["negativeFixtures"],
				message:
					"security_intelligence:negative_fixtures_not_unique_and_sorted",
			});
		}
	});
export type SecurityIntelligenceContractSnapshot = z.infer<
	typeof securityIntelligenceContractSnapshotSchema
>;

export const nightworkersV1ContractSnapshotSchema = z
	.object({
		contractVersion: z.literal(NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION),
		schemaFileSha256: sha256DigestSchema,
		fixtureFileSha256: sha256DigestSchema,
	})
	.strict();
export type NightworkersV1ContractSnapshot = z.infer<
	typeof nightworkersV1ContractSnapshotSchema
>;

export const nightworkersSecurityIntelligenceV1ContractSnapshotSchema = z
	.object({
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		schemaFileSha256: sha256DigestSchema,
		fixtureFileSha256: sha256DigestSchema,
	})
	.strict();
export type NightworkersSecurityIntelligenceV1ContractSnapshot = z.infer<
	typeof nightworkersSecurityIntelligenceV1ContractSnapshotSchema
>;

export const securityIntelligenceStage0BaselineSchema = z
	.object({
		schemaVersion: z.literal(1),
		evidenceKind: z.literal("security_intelligence_stage_0_baseline"),
		capturedAt: z.string().datetime({ offset: false, precision: 3 }),
		baselineCommit: z.string().regex(/^[a-f0-9]{40}$/),
		scope: securityIntelligenceSafeTextSchema,
		workingTreeContext: z
			.object({
				excludedFromPr1: z.array(securityIntelligenceSafeTextSchema).max(100),
			})
			.strict(),
		nightworkersV1: nightworkersV1ContractSnapshotSchema,
		nightworkersSecurityIntelligenceV1:
			nightworkersSecurityIntelligenceV1ContractSnapshotSchema,
		assessmentContract: securityIntelligenceContractSnapshotSchema,
		verification: z
			.object({
				positiveFixtures: z.literal("pass"),
				negativeFixtures: z.literal("pass"),
				semanticAssessmentRefs: z.literal("pass"),
				canonicalHashRepeatability: z.literal("pass"),
			})
			.strict(),
		privacy: z
			.object({
				absoluteHomePathsIncluded: z.literal(false),
				credentialsIncluded: z.literal(false),
				sourceBodiesIncluded: z.literal(false),
			})
			.strict(),
	})
	.strict();
export type SecurityIntelligenceStage0Baseline = z.infer<
	typeof securityIntelligenceStage0BaselineSchema
>;

function sha256(value: string | Uint8Array): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function fileSha256(relativePath: string): Promise<`sha256:${string}`> {
	const bytes = await Bun.file(path.join(repositoryRoot, relativePath)).bytes();
	return sha256(bytes);
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function isUniqueAndSorted(values: readonly string[]): boolean {
	return values.every(
		(value, index) =>
			index === 0 || compareCodeUnits(values[index - 1], value) < 0,
	);
}

function assertUniqueFixtureNames(
	names: readonly string[],
	kind: string,
): void {
	if (new Set(names).size !== names.length) {
		throw new Error(`security_intelligence:duplicate_${kind}_fixture_name`);
	}
}

export async function buildSecurityIntelligenceContractSnapshot(): Promise<{
	assessmentContract: SecurityIntelligenceContractSnapshot;
	nightworkersV1: NightworkersV1ContractSnapshot;
	nightworkersSecurityIntelligenceV1: NightworkersSecurityIntelligenceV1ContractSnapshot;
}> {
	const positiveEntries = Object.entries(
		positiveSecurityIntelligenceAssessmentFixtures,
	).sort(([left], [right]) => compareCodeUnits(left, right));
	assertUniqueFixtureNames(
		positiveEntries.map(([name]) => name),
		"positive",
	);
	assertUniqueFixtureNames(
		negativeSecurityIntelligenceAssessmentFixtures.map(
			(fixture) => fixture.name,
		),
		"negative",
	);

	const fixtures = positiveEntries.map(([name, rawFixture]) => {
		fixtureNameSchema.parse(name);
		let fixture: ReturnType<typeof parseSecurityIntelligenceAssessmentV1>;
		try {
			fixture = parseSecurityIntelligenceAssessmentV1(rawFixture);
		} catch (error) {
			throw new Error(
				`security_intelligence:positive_fixture_invalid:${name}`,
				{ cause: error },
			);
		}
		return {
			name,
			assessmentRef: fixture.assessmentRef,
			sha256: sha256(
				`${SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION}\0${name}\0${canonicalStringifySecurityIntelligenceValue(fixture)}`,
			),
		};
	});

	const negativeFixtures = negativeSecurityIntelligenceAssessmentFixtures
		.map((fixture) => {
			fixtureNameSchema.parse(fixture.name);
			assertNegativeFixtureRejected(fixture);
			return {
				name: fixture.name,
				expectedIssue: fixture.expectedIssue,
				sha256: sha256(
					`${SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION}\0${fixture.name}\0${canonicalStringifySecurityIntelligenceValue(fixture.input)}`,
				),
				validator: fixture.validator,
			};
		})
		.sort((left, right) => compareCodeUnits(left.name, right.name));

	const fixtureSetSha256 = sha256(
		canonicalStringifySecurityIntelligenceValue({ fixtures, negativeFixtures }),
	);
	const [
		schemaFileSha256,
		schemaComponentsFileSha256,
		canonicalizationFileSha256,
		fixtureSourceFileSha256,
		negativeFixtureSourceFileSha256,
		verifierFileSha256,
		nightworkersSchemaFileSha256,
		nightworkersFixtureFileSha256,
		nightworkersSecurityIntelligenceSchemaFileSha256,
		nightworkersSecurityIntelligenceFixtureFileSha256,
	] = await Promise.all([
		fileSha256("shared/schemas/security-intelligence-assessment.schema.ts"),
		fileSha256(
			"shared/schemas/security-intelligence-assessment-components.schema.ts",
		),
		fileSha256("shared/security-intelligence-assessment-contract.ts"),
		fileSha256("shared/fixtures/security-intelligence-assessment-v1.ts"),
		fileSha256(
			"shared/fixtures/security-intelligence-assessment-v1-negative.ts",
		),
		fileSha256("scripts/verify-security-intelligence-contract.ts"),
		fileSha256(
			"shared/schemas/nightworkers-security-scan-integration.schema.ts",
		),
		fileSha256("shared/fixtures/nightworkers-security-scan-integration-v1.ts"),
		fileSha256("shared/schemas/nightworkers-security-intelligence.schema.ts"),
		fileSha256("shared/fixtures/nightworkers-security-intelligence-v1.json"),
	]);
	const nightworkersSecurityIntelligenceFixture =
		nightworkersSecurityIntelligenceSuccessEnvelopeSchema.parse(
			JSON.parse(
				await Bun.file(
					path.join(
						repositoryRoot,
						"shared/fixtures/nightworkers-security-intelligence-v1.json",
					),
				).text(),
			),
		);
	parseNightworkersSecurityIntelligenceBundle(
		nightworkersSecurityIntelligenceFixture.data,
	);

	return {
		assessmentContract: securityIntelligenceContractSnapshotSchema.parse({
			contractVersion: SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION,
			schemaFileSha256,
			schemaComponentsFileSha256,
			canonicalizationFileSha256,
			fixtureSourceFileSha256,
			negativeFixtureSourceFileSha256,
			verifierFileSha256,
			positiveFixtureCount: fixtures.length,
			negativeFixtureCount: negativeFixtures.length,
			fixtureSetSha256,
			fixtures,
			negativeFixtures,
		}),
		nightworkersV1: nightworkersV1ContractSnapshotSchema.parse({
			contractVersion: NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION,
			schemaFileSha256: nightworkersSchemaFileSha256,
			fixtureFileSha256: nightworkersFixtureFileSha256,
		}),
		nightworkersSecurityIntelligenceV1:
			nightworkersSecurityIntelligenceV1ContractSnapshotSchema.parse({
				contractVersion: NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
				schemaFileSha256: nightworkersSecurityIntelligenceSchemaFileSha256,
				fixtureFileSha256: nightworkersSecurityIntelligenceFixtureFileSha256,
			}),
	};
}

function assertNegativeFixtureRejected(
	fixture: (typeof negativeSecurityIntelligenceAssessmentFixtures)[number],
): void {
	if (fixture.validator === "contract") {
		try {
			parseSecurityIntelligenceAssessmentV1(fixture.input);
		} catch (error) {
			if (errorHasExpectedIssue(error, fixture.expectedIssue)) {
				return;
			}
			throw new Error(
				`security_intelligence:negative_fixture_issue_mismatch:${fixture.name}`,
				{ cause: error },
			);
		}
		throw new Error(
			`security_intelligence:negative_fixture_accepted:${fixture.name}`,
		);
	}

	const result = securityIntelligenceAssessmentV1Schema.safeParse(
		fixture.input,
	);
	if (result.success) {
		throw new Error(
			`security_intelligence:negative_fixture_accepted:${fixture.name}`,
		);
	}
	if (
		!result.error.issues.some(
			(issue) =>
				issue.code === fixture.expectedIssue ||
				issue.message === fixture.expectedIssue,
		)
	) {
		throw new Error(
			`security_intelligence:negative_fixture_issue_mismatch:${fixture.name}`,
		);
	}
}

function errorHasExpectedIssue(error: unknown, expectedIssue: string): boolean {
	if (error instanceof z.ZodError) {
		return error.issues.some(
			(issue) =>
				issue.code === expectedIssue || issue.message === expectedIssue,
		);
	}
	return error instanceof Error && error.message === expectedIssue;
}

export function assertSecurityIntelligenceBaselineMatches(
	computed: Awaited<
		ReturnType<typeof buildSecurityIntelligenceContractSnapshot>
	>,
	baselineInput: unknown,
): SecurityIntelligenceStage0Baseline {
	const baseline =
		securityIntelligenceStage0BaselineSchema.parse(baselineInput);
	if (
		canonicalStringifySecurityIntelligenceValue(baseline.assessmentContract) !==
		canonicalStringifySecurityIntelligenceValue(computed.assessmentContract)
	) {
		throw new Error(
			"security_intelligence:assessment_contract_baseline_mismatch",
		);
	}
	if (
		canonicalStringifySecurityIntelligenceValue(baseline.nightworkersV1) !==
		canonicalStringifySecurityIntelligenceValue(computed.nightworkersV1)
	) {
		throw new Error("security_intelligence:nightworkers_v1_baseline_mismatch");
	}
	if (
		canonicalStringifySecurityIntelligenceValue(
			baseline.nightworkersSecurityIntelligenceV1,
		) !==
		canonicalStringifySecurityIntelligenceValue(
			computed.nightworkersSecurityIntelligenceV1,
		)
	) {
		throw new Error(
			"security_intelligence:nightworkers_security_intelligence_v1_baseline_mismatch",
		);
	}
	return baseline;
}

export async function verifySecurityIntelligenceContract(
	baselinePath = securityIntelligenceBaselinePath,
): Promise<{
	ok: true;
	baseline: { path: string; matched: true };
	assessmentContract: SecurityIntelligenceContractSnapshot;
	nightworkersV1: NightworkersV1ContractSnapshot & { unchanged: true };
	nightworkersSecurityIntelligenceV1: NightworkersSecurityIntelligenceV1ContractSnapshot & {
		unchanged: true;
	};
}> {
	const computed = await buildSecurityIntelligenceContractSnapshot();
	const baselineInput: unknown = JSON.parse(
		await Bun.file(baselinePath).text(),
	);
	assertSecurityIntelligenceBaselineMatches(computed, baselineInput);
	return {
		ok: true,
		baseline: {
			path: path
				.relative(repositoryRoot, baselinePath)
				.split(path.sep)
				.join("/"),
			matched: true,
		},
		assessmentContract: computed.assessmentContract,
		nightworkersV1: { ...computed.nightworkersV1, unchanged: true },
		nightworkersSecurityIntelligenceV1: {
			...computed.nightworkersSecurityIntelligenceV1,
			unchanged: true,
		},
	};
}

async function main(): Promise<void> {
	if (process.argv.slice(2).includes("--snapshot")) {
		process.stdout.write(
			`${JSON.stringify(await buildSecurityIntelligenceContractSnapshot())}\n`,
		);
		return;
	}
	process.stdout.write(
		`${JSON.stringify(await verifySecurityIntelligenceContract())}\n`,
	);
}

if (import.meta.main) {
	await main();
}
