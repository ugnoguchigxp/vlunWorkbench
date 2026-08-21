import crypto from "node:crypto";
import {
	type ScanProfile,
	scanProfileSchema,
} from "../../../../shared/schemas/scan-profile.schema";
import { canonicalJson } from "./diff/diff-scan-plan";

export function hashResolvedProfile(profile: ScanProfile): string {
	return `sha256:${crypto.createHash("sha256").update(canonicalJson(profile)).digest("hex")}`;
}

export function readStoredResolvedProfile(
	metadata: Record<string, unknown> | null | undefined,
	expectedProfileId: string,
): ScanProfile | null {
	const parsed = scanProfileSchema.safeParse(metadata?.resolvedProfile);
	if (!parsed.success || parsed.data.id !== expectedProfileId) return null;
	return parsed.data;
}
