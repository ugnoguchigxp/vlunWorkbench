import { z } from "zod";

const cvssSchema = z.object({
	version: z.string().min(1).max(20),
	vector: z.string().min(1).max(500),
	baseScore: z.number().min(0).max(10).nullable(),
	source: z.string().max(200).nullable(),
});

export const findingRiskContextSchema = z.object({
	cweIds: z
		.array(z.string().regex(/^CWE-\d+$/i))
		.max(100)
		.default([]),
	advisoryAliases: z.array(z.string().min(1).max(200)).max(200).default([]),
	cvss: z.array(cvssSchema).max(20).default([]),
	references: z.array(z.string().url()).max(200).default([]),
	package: z
		.object({
			ecosystem: z.string().max(100),
			name: z.string().min(1).max(500),
			version: z.string().max(500),
			purl: z.string().max(2000).nullable(),
		})
		.nullable()
		.default(null),
	fixedVersions: z.array(z.string().max(500)).max(100).default([]),
	rule: z
		.object({
			source: z.string().max(500),
			version: z.string().max(200).nullable(),
		})
		.nullable()
		.default(null),
	reachability: z
		.enum(["reachable", "unreachable", "unknown"])
		.default("unknown"),
	reachabilityEvidenceRefs: z.array(z.string().max(200)).max(100).default([]),
	vex: z
		.object({
			status: z.string().max(100),
			statementRef: z.string().max(2000),
		})
		.nullable()
		.default(null),
	kev: z
		.object({
			listed: z.boolean(),
			snapshotDate: z.string().date(),
			snapshotSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
		})
		.nullable()
		.default(null),
	epss: z
		.object({
			score: z.number().min(0).max(1),
			percentile: z.number().min(0).max(1),
			snapshotDate: z.string().date(),
			snapshotSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
		})
		.nullable()
		.default(null),
	derivedPriority: z.enum(["p0", "p1", "p2", "p3", "p4"]),
	priorityReasons: z.array(z.string().min(1).max(500)).min(1).max(20),
});

export type FindingRiskContext = z.infer<typeof findingRiskContextSchema>;
