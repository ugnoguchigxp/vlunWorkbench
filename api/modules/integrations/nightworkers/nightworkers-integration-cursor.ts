import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const cursorPayloadSchema = z
	.object({
		version: z.literal(1),
		scanRunId: z.string().min(1),
		createdAt: z.string().datetime(),
		id: z.string().min(1),
		severity: z.string().nullable(),
		tool: z.string().nullable(),
	})
	.strict();

type FindingCursorPayload = z.infer<typeof cursorPayloadSchema>;

function signature(payload: string, key: string): Buffer {
	return createHmac("sha256", key).update(payload, "utf8").digest();
}

export function encodeFindingCursor(
	payload: FindingCursorPayload,
	key: string,
): string {
	const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
		"base64url",
	);
	return `${encoded}.${signature(encoded, key).toString("base64url")}`;
}

export function decodeFindingCursor(
	cursor: string,
	key: string,
): FindingCursorPayload | null {
	if (cursor.length > 2_048) return null;
	const [encoded, encodedSignature, extra] = cursor.split(".");
	if (!encoded || !encodedSignature || extra) return null;
	let supplied: Buffer;
	try {
		supplied = Buffer.from(encodedSignature, "base64url");
	} catch {
		return null;
	}
	const expected = signature(encoded, key);
	if (
		supplied.length !== expected.length ||
		!timingSafeEqual(supplied, expected)
	) {
		return null;
	}
	try {
		return cursorPayloadSchema.parse(
			JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
		);
	} catch {
		return null;
	}
}
