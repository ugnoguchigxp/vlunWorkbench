import crypto from "node:crypto";
import fs from "node:fs/promises";
import {
	attestationReceiptSchema,
	type AttestationReceipt,
} from "../../../../shared/schemas/attestation-receipt.schema";

type CommandRunner = (params: {
	binary: string;
	args: string[];
	timeoutSec: number;
}) => Promise<{ ok: boolean; exitCode: number | null }>;

export const COSIGN_SAFE_VERSION_REQUIREMENT = ">=2.6.5 <3.0.0 or >=3.1.3";

export function parseCosignVersion(
	value: string | null | undefined,
): [major: number, minor: number, patch: number] | null {
	const match = value?.match(
		/(?:^|[^0-9a-z])v?(\d+)\.(\d+)\.(\d+)([-+][0-9a-z.-]+)?(?![0-9a-z.])/i,
	);
	if (!match?.[1] || !match[2] || !match[3] || match[4]?.startsWith("-")) {
		return null;
	}
	return [
		Number.parseInt(match[1], 10),
		Number.parseInt(match[2], 10),
		Number.parseInt(match[3], 10),
	];
}

export function isCosignVersionSafe(value: string | null | undefined): boolean {
	const version = parseCosignVersion(value);
	if (!version) return false;
	const [major, minor, patch] = version;
	if (major > 3) return true;
	if (major === 3) return minor > 1 || (minor === 1 && patch >= 3);
	if (major === 2) return minor > 6 || (minor === 6 && patch >= 5);
	return false;
}

/** Offline-first Cosign verifier. It never asks Cosign to contact a registry or log. */
export class CosignAttestationProvider {
	constructor(
		private readonly commandRunner: CommandRunner,
		private readonly now: () => Date = () => new Date(),
	) {}

	async verify(params: {
		subjectPath: string;
		bundlePath: string;
		trustPolicyPath: string;
	}): Promise<AttestationReceipt> {
		const [subjectDigest, bundleDigest, trustPolicyDigest] = await Promise.all([
			digestFile(params.subjectPath),
			digestFile(params.bundlePath),
			digestFile(params.trustPolicyPath),
		]);
		let reasonCode: AttestationReceipt["reasonCode"] =
			"attestation_verification_failed";
		let verified = false;
		try {
			const result = await this.commandRunner({
				binary: "cosign",
				args: [
					"verify-blob-attestation",
					"--offline",
					"--new-bundle-format=true",
					"--check-claims=true",
					"--type",
					"slsaprovenance1",
					"--bundle",
					params.bundlePath,
					"--key",
					params.trustPolicyPath,
					params.subjectPath,
				],
				timeoutSec: 60,
			});
			verified = result.ok && result.exitCode === 0;
			reasonCode = verified ? "verified" : "attestation_verification_failed";
		} catch {
			reasonCode = "attestation_verification_failed";
		}
		return attestationReceiptSchema.parse({
			schemaVersion: 1,
			provider: "cosign",
			offline: true,
			subjectDigest,
			bundleDigest,
			trustPolicyDigest,
			verified,
			reasonCode,
			verifiedAt: this.now().toISOString(),
		});
	}
}

async function digestFile(filePath: string): Promise<string> {
	const bytes = await fs.readFile(filePath);
	return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
