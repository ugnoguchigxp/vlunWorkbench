import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { DAST_STANDARD_POLICY_HASH } from "../api/modules/dast/policy";

const baselinePath = "spec/evidence/phase-51-dast-baseline.json";
const policyPath = "spec/security-capability/dast-standard-policy.v1.json";
const groundTruthPath =
	"spec/security-capability/dast-standard-ground-truth.v1.json";

const schema = z.object({
	schemaVersion: z.literal(1),
	phase: z.literal("51"),
	generatedAt: z.string().datetime(),
	gitCommit: z.string().regex(/^[a-f0-9]{40}$/),
	defaultProfiles: z
		.array(
			z.object({
				profileId: z.string().min(1),
				dastSteps: z.array(z.string().min(1)).min(1),
				required: z.array(z.boolean()).min(1),
			}),
		)
		.min(4),
	httpBaseline: z.object({
		candidatePathsWithoutConfig: z.array(z.string().startsWith("/")).length(5),
		crawlerEnabled: z.literal(false),
		maxDepthConsumedByRunner: z.literal(false),
		methods: z.tuple([z.literal("GET")]),
		responseBodyAnalyzed: z.literal(false),
	}),
	falsePassReproductions: z
		.array(
			z.object({
				caseId: z.string().min(1),
				requestCount: z.number().int().positive(),
				transportErrorCount: z.number().int().positive(),
				currentOutcome: z.literal("passed"),
			}),
		)
		.min(2),
	scannerCoverage: z.object({
		nucleiOwnedTemplateCount: z.literal(1),
		zapBaselineMode: z.literal("passive"),
		zapBaselineRequestBudget: z.literal(20),
		juiceShopExecutedScenarios: z.literal(0),
	}),
	hashes: z.object({
		policy: z.string().startsWith("sha256:"),
		groundTruth: z.string().startsWith("sha256:"),
	}),
	residualRisk: z.string().min(1),
});

const [baselineBytes, policyBytes, groundTruthBytes] = await Promise.all([
	readFile(baselinePath),
	readFile(policyPath),
	readFile(groundTruthPath),
]);
const baselineText = new TextDecoder().decode(baselineBytes);
const baseline = schema.parse(JSON.parse(baselineText) as unknown);
if (
	baseline.hashes.policy !== sha256(policyBytes) ||
	baseline.hashes.groundTruth !== sha256(groundTruthBytes)
) {
	throw new Error("phase_51_baseline_policy_or_ground_truth_hash_mismatch");
}
if (DAST_STANDARD_POLICY_HASH !== sha256(policyBytes)) {
	throw new Error("phase_51_runtime_policy_hash_mismatch");
}
if (
	/(?:\/Users\/|\/home\/|[A-Z]:\\\\Users\\\\)/.test(baselineText) ||
	/(?:authorization|cookie|password|secret)\s*[:=]\s*[^\s"]+/i.test(
		baselineText,
	)
) {
	throw new Error("phase_51_baseline_contains_secret_or_absolute_home_path");
}
const ancestor = Bun.spawn(
	["git", "merge-base", "--is-ancestor", baseline.gitCommit, "HEAD"],
	{ stdout: "pipe", stderr: "pipe" },
);
if ((await ancestor.exited) !== 0) {
	throw new Error("phase_51_baseline_commit_is_not_ancestor");
}
console.log(
	JSON.stringify({
		ok: true,
		baselineCommit: baseline.gitCommit,
		falsePassCases: baseline.falsePassReproductions.length,
		hashes: baseline.hashes,
	}),
);

function sha256(value: Uint8Array): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
