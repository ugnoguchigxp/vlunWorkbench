import path from "node:path";
import {
	type SlsaProvenancePolicy,
	type SlsaProvenanceReceipt,
	slsaProvenancePolicySchema,
	slsaProvenanceReceiptSchema,
} from "../../../../shared/schemas/attestation-receipt.schema";
import {
	parseStrictJsonDocument,
	readStrictJsonDocumentBytes,
} from "../../api-schema-fuzz/strict-json-document";
import { sha256File } from "./attestation-inputs";

type CommandRunner = (params: {
	binary: string;
	args: string[];
	timeoutSec: number;
}) => Promise<{ ok: boolean; exitCode: number | null }>;

export const SLSA_VERIFIER_VERSION = "2.7.1";

export function parseSlsaVerifierVersion(
	value: string | null | undefined,
): string | null {
	return value?.match(/(?:GitVersion:\s*)?v?(\d+\.\d+\.\d+)/i)?.[1] ?? null;
}

export async function loadSlsaProvenancePolicy(
	policyPath: string,
): Promise<SlsaProvenancePolicy> {
	return slsaProvenancePolicySchema.parse(
		parseStrictJsonDocument(
			await readStrictJsonDocumentBytes(policyPath, path.dirname(policyPath)),
		),
	);
}

/**
 * Verifies a local artifact against a local provenance envelope and explicit
 * source/builder expectations. slsa-verifier refreshes Sigstore trust roots,
 * so this provider deliberately reports offline=false.
 */
export class SlsaProvenanceProvider {
	constructor(
		private readonly commandRunner: CommandRunner,
		private readonly now: () => Date = () => new Date(),
	) {}

	async verify(params: {
		subjectPath: string;
		provenancePath: string;
		policyPath: string;
		timeoutSec?: number;
	}): Promise<SlsaProvenanceReceipt> {
		const [subjectDigest, provenanceDigest, policyDigest] = await Promise.all([
			sha256File(params.subjectPath),
			sha256File(params.provenancePath),
			sha256File(params.policyPath),
		]);
		let expected: SlsaProvenancePolicy;
		try {
			expected = await loadSlsaProvenancePolicy(params.policyPath);
		} catch {
			return slsaProvenanceReceiptSchema.parse({
				schemaVersion: 1,
				provider: "slsa-verifier",
				offline: false,
				subjectDigest,
				provenanceDigest,
				policyDigest,
				expected: null,
				verified: false,
				reasonCode: "slsa_policy_invalid",
				verifiedAt: this.now().toISOString(),
			});
		}
		const args = [
			"verify-artifact",
			params.subjectPath,
			"--provenance-path",
			params.provenancePath,
			"--source-uri",
			expected.sourceUri,
		];
		if (expected.builderId) args.push("--builder-id", expected.builderId);
		if (expected.sourceRef) {
			args.push(
				expected.sourceRef.kind === "branch"
					? "--source-branch"
					: expected.sourceRef.kind === "tag"
						? "--source-tag"
						: "--source-versioned-tag",
				expected.sourceRef.value,
			);
		}
		let verified = false;
		try {
			const result = await this.commandRunner({
				binary: "slsa-verifier",
				args,
				timeoutSec: params.timeoutSec ?? 60,
			});
			verified = result.ok && result.exitCode === 0;
		} catch {
			verified = false;
		}
		return slsaProvenanceReceiptSchema.parse({
			schemaVersion: 1,
			provider: "slsa-verifier",
			offline: false,
			subjectDigest,
			provenanceDigest,
			policyDigest,
			expected,
			verified,
			reasonCode: verified ? "verified" : "provenance_verification_failed",
			verifiedAt: this.now().toISOString(),
		});
	}
}
