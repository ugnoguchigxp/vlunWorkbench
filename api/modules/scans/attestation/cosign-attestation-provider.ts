import {
	type AttestationReceipt,
	attestationReceiptSchema,
} from "../../../../shared/schemas/attestation-receipt.schema";
import { sha256File } from "./attestation-inputs";

type CommandRunner = (params: {
	binary: string;
	args: string[];
	timeoutSec: number;
}) => Promise<{ ok: boolean; exitCode: number | null }>;

export const COSIGN_SAFE_VERSION_REQUIREMENT = ">=2.6.5 <3.0.0 or >=3.1.3";
export const COSIGN_TRUSTED_ROOT_CONTAINER_PATH =
	"/opt/vuln-workbench/scanner-data/sigstore-trusted-root.json";
export const COSIGN_TRUSTED_ROOT_REPOSITORY_PATH =
	"docker/toolbox/scanner-data/sigstore-trusted-root.json";

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
		trustedRootPath: string;
		timeoutSec?: number;
	}): Promise<AttestationReceipt> {
		const [subjectDigest, bundleDigest, trustPolicyDigest] = await Promise.all([
			sha256File(params.subjectPath),
			sha256File(params.bundlePath),
			sha256File(params.trustPolicyPath),
		]);
		let reasonCode: AttestationReceipt["reasonCode"] =
			"attestation_verification_failed";
		let verified = false;
		try {
			const result = await this.commandRunner({
				binary: "cosign",
				args: [
					"verify-blob-attestation",
					"--check-claims=true",
					"--type",
					"slsaprovenance1",
					"--bundle",
					params.bundlePath,
					"--key",
					params.trustPolicyPath,
					"--trusted-root",
					params.trustedRootPath,
					params.subjectPath,
				],
				timeoutSec: params.timeoutSec ?? 60,
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
