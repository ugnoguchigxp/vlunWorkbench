import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	buildProfileInputBindings,
	type ProfileInputBindings,
	resolveRepositoryRelativeFile,
} from "../../attestation/attestation-inputs";

export type ProfileInputSnapshot = {
	rootPath: string;
	bindings: ProfileInputBindings;
	cleanup: () => Promise<void>;
};

export function bindNonFileProfileInputs(
	bindings: ProfileInputBindings,
	params: {
		authContextId?: string;
		identityRole?: string;
		dependencyResolutionMode: "offline" | "registry";
		mavenResolutionConfigDigest?: string;
		mavenResolutionSourceDigest?: string;
		mavenResolverImageId?: string;
	},
): ProfileInputBindings {
	return {
		...bindings,
		authContextId: params.authContextId,
		identityRole: params.identityRole,
		dependencyResolutionMode: params.dependencyResolutionMode,
		mavenResolutionConfigDigest: params.mavenResolutionConfigDigest,
		mavenResolutionSourceDigest: params.mavenResolutionSourceDigest,
		mavenResolverImageId: params.mavenResolverImageId,
	};
}

export async function materializeProfileInputSnapshot(params: {
	repositoryPath: string;
	imageRef?: string;
	imageTar?: string;
	attestationSubject?: string;
	attestationBundle?: string;
	trustPolicy?: string;
	slsaProvenance?: string;
	slsaPolicy?: string;
}): Promise<ProfileInputSnapshot | null> {
	const files = [
		[params.imageTar, "image tar"],
		[params.attestationSubject, "subject"],
		[params.attestationBundle, "bundle"],
		[params.trustPolicy, "trust policy"],
		[params.slsaProvenance, "SLSA provenance"],
		[params.slsaPolicy, "SLSA policy"],
	].filter((entry): entry is [string, string] => Boolean(entry[0]));
	if (files.length === 0) return null;

	const rootPath = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "vuln-workbench-inputs-")),
	);
	let cleaned = false;
	const cleanup = async () => {
		if (cleaned) return;
		await fs.rm(rootPath, { recursive: true, force: true });
		cleaned = true;
	};

	try {
		for (const [value, label] of files) {
			const source = await resolveRepositoryRelativeFile(
				params.repositoryPath,
				value,
				label,
			);
			const destination = path.resolve(rootPath, value);
			if (!isWithin(rootPath, destination)) {
				throw new Error(`profile_input_snapshot_path_invalid:${label}`);
			}
			await fs.mkdir(path.dirname(destination), { recursive: true });
			await fs.copyFile(source, destination);
		}
		const bindings = await buildProfileInputBindings({
			...params,
			repoPath: rootPath,
		});
		return { rootPath, bindings, cleanup };
	} catch (error) {
		try {
			await cleanup();
		} catch {
			throw new Error("profile_input_snapshot_cleanup_failed");
		}
		throw error;
	}
}

function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}
