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
					"verify-blob",
					"--offline",
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
