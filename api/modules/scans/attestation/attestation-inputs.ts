import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type AttestationInputPaths = {
	subjectPath: string;
	bundlePath: string;
	trustPolicyPath: string;
};

export type SlsaProvenanceInputPaths = {
	subjectPath: string;
	provenancePath: string;
	policyPath: string;
};

export type ProfileInputBindings = Record<string, string | undefined>;

/** Resolve user-supplied attestation files without allowing reads outside the scan snapshot. */
export async function resolveAttestationInputPaths(params: {
	repoPath: string;
	subject: string;
	bundle: string;
	trustPolicy: string;
}): Promise<AttestationInputPaths> {
	const [subjectPath, bundlePath, trustPolicyPath] = await Promise.all([
		resolveRepositoryRelativeFile(params.repoPath, params.subject, "subject"),
		resolveRepositoryRelativeFile(params.repoPath, params.bundle, "bundle"),
		resolveRepositoryRelativeFile(
			params.repoPath,
			params.trustPolicy,
			"trust policy",
		),
	]);
	return { subjectPath, bundlePath, trustPolicyPath };
}

/** Resolve a local artifact, its SLSA provenance, and the expected source policy. */
export async function resolveSlsaProvenanceInputPaths(params: {
	repoPath: string;
	subject: string;
	provenance: string;
	policy: string;
}): Promise<SlsaProvenanceInputPaths> {
	const [subjectPath, provenancePath, policyPath] = await Promise.all([
		resolveRepositoryRelativeFile(params.repoPath, params.subject, "subject"),
		resolveRepositoryRelativeFile(
			params.repoPath,
			params.provenance,
			"SLSA provenance",
		),
		resolveRepositoryRelativeFile(
			params.repoPath,
			params.policy,
			"SLSA policy",
		),
	]);
	return { subjectPath, provenancePath, policyPath };
}

export async function resolveRepositoryRelativeFile(
	repoPath: string,
	value: string,
	label: string,
): Promise<string> {
	const root = await fs.realpath(repoPath);
	if (!value.trim() || path.isAbsolute(value) || value.includes("\0")) {
		throw new Error(`attestation_input_invalid:${label}`);
	}
	const lexical = path.resolve(root, value);
	if (!isWithin(root, lexical)) {
		throw new Error(`attestation_input_outside_repository:${label}`);
	}
	const real = await fs.realpath(lexical).catch(() => {
		throw new Error(`attestation_input_missing:${label}`);
	});
	if (!isWithin(root, real)) {
		throw new Error(`attestation_input_outside_repository:${label}`);
	}
	const stat = await fs.stat(real);
	if (!stat.isFile()) throw new Error(`attestation_input_not_file:${label}`);
	return real;
}

export async function buildProfileInputBindings(params: {
	repoPath: string;
	imageRef?: string;
	imageTar?: string;
	attestationSubject?: string;
	attestationBundle?: string;
	trustPolicy?: string;
	slsaProvenance?: string;
	slsaPolicy?: string;
}): Promise<ProfileInputBindings> {
	const bindings: ProfileInputBindings = { imageRef: params.imageRef };
	if (params.imageTar) {
		bindings.imageTar = await fingerprintRepositoryRelativeFile(
			params.repoPath,
			params.imageTar,
			"image tar",
		);
	}
	const hasCosignInput = Boolean(
		params.attestationBundle || params.trustPolicy,
	);
	const hasSlsaInput = Boolean(params.slsaProvenance || params.slsaPolicy);
	if (hasCosignInput && hasSlsaInput) {
		throw new Error("attestation_input_ambiguous");
	}
	if (hasCosignInput) {
		if (
			!params.attestationSubject ||
			!params.attestationBundle ||
			!params.trustPolicy
		) {
			throw new Error("attestation_input_missing");
		}
		const paths = await resolveAttestationInputPaths({
			repoPath: params.repoPath,
			subject: params.attestationSubject,
			bundle: params.attestationBundle,
			trustPolicy: params.trustPolicy,
		});
		const [subjectDigest, bundleDigest, trustPolicyDigest] = await Promise.all([
			sha256File(paths.subjectPath),
			sha256File(paths.bundlePath),
			sha256File(paths.trustPolicyPath),
		]);
		bindings.attestationSubject = fingerprintValue(
			params.attestationSubject,
			subjectDigest,
		);
		bindings.attestationBundle = fingerprintValue(
			params.attestationBundle,
			bundleDigest,
		);
		bindings.trustPolicy = fingerprintValue(
			params.trustPolicy,
			trustPolicyDigest,
		);
	}
	if (hasSlsaInput) {
		if (
			!params.attestationSubject ||
			!params.slsaProvenance ||
			!params.slsaPolicy
		) {
			throw new Error("attestation_input_missing");
		}
		const paths = await resolveSlsaProvenanceInputPaths({
			repoPath: params.repoPath,
			subject: params.attestationSubject,
			provenance: params.slsaProvenance,
			policy: params.slsaPolicy,
		});
		const [subjectDigest, provenanceDigest, policyDigest] = await Promise.all([
			sha256File(paths.subjectPath),
			sha256File(paths.provenancePath),
			sha256File(paths.policyPath),
		]);
		bindings.attestationSubject = fingerprintValue(
			params.attestationSubject,
			subjectDigest,
		);
		bindings.slsaProvenance = fingerprintValue(
			params.slsaProvenance,
			provenanceDigest,
		);
		bindings.slsaPolicy = fingerprintValue(params.slsaPolicy, policyDigest);
	}
	if (params.attestationSubject && !hasCosignInput && !hasSlsaInput) {
		throw new Error("attestation_input_missing");
	}
	return bindings;
}

export async function fingerprintRepositoryRelativeFile(
	repoPath: string,
	value: string,
	label: string,
): Promise<string> {
	const resolved = await resolveRepositoryRelativeFile(repoPath, value, label);
	return fingerprintValue(value, await sha256File(resolved));
}

export async function sha256File(filePath: string): Promise<string> {
	const handle = await fs.open(filePath, "r");
	try {
		const stat = await handle.stat();
		if (!stat.isFile()) throw new Error("attestation_input_not_file");
		const hash = crypto.createHash("sha256");
		const buffer = Buffer.allocUnsafe(1024 * 1024);
		let offset = 0;
		while (offset < stat.size) {
			const { bytesRead } = await handle.read(
				buffer,
				0,
				Math.min(buffer.length, stat.size - offset),
				offset,
			);
			if (bytesRead === 0) throw new Error("attestation_input_changed");
			hash.update(buffer.subarray(0, bytesRead));
			offset += bytesRead;
		}
		const trailing = Buffer.allocUnsafe(1);
		if ((await handle.read(trailing, 0, 1, stat.size)).bytesRead > 0)
			throw new Error("attestation_input_changed");
		return `sha256:${hash.digest("hex")}`;
	} finally {
		await handle.close();
	}
}

function fingerprintValue(value: string, digest: string): string {
	return `${value.replaceAll(path.sep, "/")}@${digest}`;
}

function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}
