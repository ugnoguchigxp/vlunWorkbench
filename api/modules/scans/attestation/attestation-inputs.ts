import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type AttestationInputPaths = {
	subjectPath: string;
	bundlePath: string;
	trustPolicyPath: string;
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
}): Promise<ProfileInputBindings> {
	const bindings: ProfileInputBindings = { imageRef: params.imageRef };
	if (params.imageTar) {
		bindings.imageTar = await fingerprintRepositoryRelativeFile(
			params.repoPath,
			params.imageTar,
			"image tar",
		);
	}
	if (
		params.attestationSubject ||
		params.attestationBundle ||
		params.trustPolicy
	) {
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
	return `sha256:${crypto
		.createHash("sha256")
		.update(await fs.readFile(filePath))
		.digest("hex")}`;
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
