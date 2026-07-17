import { z } from "zod";

export const WRITER_PROTOCOL_VERSION = 2 as const;

export const writerMethodSchema = z.enum(["run", "all", "values", "get"]);
export type WriterMethod = z.infer<typeof writerMethodSchema>;

export type EncodedValue =
	| null
	| boolean
	| number
	| string
	| { $type: "bigint"; value: string }
	| { $type: "bytes"; value: string }
	| { $type: "object"; value: { [key: string]: EncodedValue } }
	| EncodedValue[];

const base64Schema = z
	.string()
	.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

export const encodedValueSchema: z.ZodType<EncodedValue> = z.lazy(() =>
	z.union([
		z.null(),
		z.boolean(),
		z.number(),
		z.string(),
		z
			.object({
				$type: z.literal("bigint"),
				value: z.string().regex(/^-?\d+$/),
			})
			.strict(),
		z.object({ $type: z.literal("bytes"), value: base64Schema }).strict(),
		z
			.object({
				$type: z.literal("object"),
				value: z.record(z.string(), encodedValueSchema),
			})
			.strict(),
		z.array(encodedValueSchema),
	]),
);

export const writerStatementSchema = z
	.object({
		sql: z.string().min(1),
		params: z.array(encodedValueSchema),
		method: writerMethodSchema,
	})
	.strict();

export type WriterStatement = {
	sql: string;
	params: EncodedValue[];
	method: WriterMethod;
};

const requestBaseSchema = z
	.object({
		protocolVersion: z.literal(WRITER_PROTOCOL_VERSION),
		requestId: z.string().min(1),
		databaseId: z.string().length(64),
	})
	.strict();

export const writerRequestSchema = z.discriminatedUnion("kind", [
	requestBaseSchema.extend({ kind: z.literal("health") }),
	requestBaseSchema.extend({
		kind: z.literal("execute"),
		statement: writerStatementSchema,
	}),
	requestBaseSchema.extend({
		kind: z.literal("atomic_batch"),
		statements: z.array(writerStatementSchema).min(1),
	}),
	requestBaseSchema.extend({
		kind: z.literal("admin_migrate"),
		filename: z.string().min(1),
		sql: z.string().min(1),
	}),
]);

export type WriterRequest = z.infer<typeof writerRequestSchema>;

export type WriterErrorCode =
	| "WRITER_INVALID_REQUEST"
	| "WRITER_DATABASE_MISMATCH"
	| "WRITER_REQUEST_TOO_LARGE"
	| "WRITER_STATEMENT_FAILED"
	| "WRITER_TRANSACTION_FAILED"
	| "WRITER_INTERNAL_ERROR";

export type WriterResponse = {
	protocolVersion: typeof WRITER_PROTOCOL_VERSION;
	requestId: string;
	writerInstanceId: string;
	sequence: number;
	ok: boolean;
	result?: EncodedValue;
	error?: {
		code: WriterErrorCode;
		message: string;
		sqliteCode?: string;
	};
};

export const writerHealthSchema = z
	.object({
		status: z.enum(["ready", "draining"]),
		writerInstanceId: z.string().min(1),
		databaseId: z.string().length(64),
		protocolVersion: z.literal(WRITER_PROTOCOL_VERSION),
		pid: z.number().int().positive(),
		queueDepth: z.number().int().nonnegative(),
		lastSequence: z.number().int().nonnegative(),
	})
	.strict();

export type WriterHealth = z.infer<typeof writerHealthSchema>;

const writerResponseBaseSchema = z.object({
	protocolVersion: z.number().int().nonnegative(),
	requestId: z.string(),
	writerInstanceId: z.string().min(1),
	sequence: z.number().int().nonnegative(),
});

const writerErrorSchema = z
	.object({
		code: z.enum([
			"WRITER_INVALID_REQUEST",
			"WRITER_DATABASE_MISMATCH",
			"WRITER_REQUEST_TOO_LARGE",
			"WRITER_STATEMENT_FAILED",
			"WRITER_TRANSACTION_FAILED",
			"WRITER_INTERNAL_ERROR",
		]),
		message: z.string(),
		sqliteCode: z.string().optional(),
	})
	.strict();

export const writerResponseSchema = z.discriminatedUnion("ok", [
	writerResponseBaseSchema
		.extend({
			ok: z.literal(true),
			result: encodedValueSchema.optional(),
			error: z.never().optional(),
		})
		.strict(),
	writerResponseBaseSchema
		.extend({
			ok: z.literal(false),
			result: z.never().optional(),
			error: writerErrorSchema,
		})
		.strict(),
]);
