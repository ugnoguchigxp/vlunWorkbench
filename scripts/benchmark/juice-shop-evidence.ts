import crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
	SecurityProbe,
	SecurityProbeFinding,
} from "../../api/modules/dast/security-probe-detector";
import { canonicalJson } from "../../api/modules/scans/diff-scan-plan";

export type JuiceShopRequestEvidence = {
	method: string;
	path: string;
	queryKeys: string[];
	status: number;
	responseBytes: number;
	responseShapeHash: string;
};

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const juiceShopRequestEvidenceSchema = z
	.object({
		method: z.string().regex(/^[A-Z]+$/),
		path: z.string().startsWith("/").max(2_000),
		queryKeys: z.array(z.string().min(1).max(200)).max(100),
		status: z.number().int().min(0).max(599),
		responseBytes: z
			.number()
			.int()
			.nonnegative()
			.max(16 * 1024 * 1024),
		responseShapeHash: sha256Schema,
	})
	.strict();

export const juiceShopExecutionEvidenceSchema = z
	.object({
		schemaVersion: z.literal(1),
		scenarioId: z.string().regex(/^juice-[a-z0-9-]+$/),
		targetKind: z.enum(["vulnerable", "fixed"]),
		controlId: z.string().regex(/^[a-z0-9][a-z0-9/-]+$/),
		probe: z
			.object({
				kind: z.string().min(1).max(100),
				cwe: z.string().regex(/^CWE-\d+$/),
			})
			.passthrough(),
		findings: z
			.array(
				z
					.object({
						id: z.string().min(1).max(300),
						ruleId: z.string().min(1).max(100),
						cwe: z.string().regex(/^CWE-\d+$/),
						title: z.string().min(1).max(500),
					})
					.strict(),
			)
			.max(100),
		requests: z.array(juiceShopRequestEvidenceSchema).min(1).max(50),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.findings.some((finding) => finding.cwe !== value.probe.cwe)) {
			ctx.addIssue({
				code: "custom",
				path: ["findings"],
				message: "Finding CWE must match the probe CWE",
			});
		}
		if (
			new Set(value.findings.map((finding) => finding.id)).size !==
			value.findings.length
		) {
			ctx.addIssue({
				code: "custom",
				path: ["findings"],
				message: "Finding IDs must be unique",
			});
		}
	});

export type JuiceShopExecutionEvidence = z.infer<
	typeof juiceShopExecutionEvidenceSchema
>;

export async function writeJuiceShopExecutionEvidence(params: {
	evidenceRoot: string;
	scenarioId: string;
	targetKind: "vulnerable" | "fixed";
	controlId: string;
	probe: SecurityProbe;
	findings: SecurityProbeFinding[];
	requests: JuiceShopRequestEvidence[];
}): Promise<{ evidencePath: string; evidenceHash: string }> {
	const relativePath = path.posix.join(
		params.scenarioId,
		`${params.targetKind}.json`,
	);
	const absolutePath = path.resolve(params.evidenceRoot, relativePath);
	const relative = path.relative(
		path.resolve(params.evidenceRoot),
		absolutePath,
	);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error("juice_shop_evidence_output_path_invalid");
	}
	await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
	const artifact = juiceShopExecutionEvidenceSchema.parse({
		schemaVersion: 1,
		scenarioId: params.scenarioId,
		targetKind: params.targetKind,
		controlId: params.controlId,
		probe: params.probe,
		findings: params.findings,
		requests: params.requests,
	});
	const bytes = `${canonicalJson(artifact)}\n`;
	if (Buffer.byteLength(bytes) > 16 * 1024 * 1024)
		throw new Error("juice_shop_evidence_output_too_large");
	await Bun.write(absolutePath, bytes, { mode: 0o600 });
	return {
		evidencePath: relativePath,
		evidenceHash: `sha256:${crypto
			.createHash("sha256")
			.update(bytes)
			.digest("hex")}`,
	};
}

export function responseShapeHash(value: unknown): string {
	return `sha256:${crypto
		.createHash("sha256")
		.update(canonicalJson(jsonShape(value)))
		.digest("hex")}`;
}

function jsonShape(value: unknown): unknown {
	if (Array.isArray(value)) {
		const shapes = value.slice(0, 20).map(jsonShape);
		return { type: "array", length: value.length, items: shapes };
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.slice(0, 100)
				.map(([key, nested]) => [key, jsonShape(nested)]),
		);
	}
	if (value === null) return "null";
	return typeof value;
}
