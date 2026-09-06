import path from "node:path";
import { pinnedImageDigest } from "./benchmark/owasp-benchmark-runtime";

export function buildOsvFixtureCommand(params: {
	fixturePath: string;
	databaseRoot: string;
	outputPath: string;
	image?: string;
}): string[] {
	const args = [
		"scan",
		"source",
		"--offline",
		"--no-resolve",
		"--format",
		"json",
		"--output-file",
	];
	if (!params.image)
		return [
			"osv-scanner",
			...args,
			params.outputPath,
			"--recursive",
			params.fixturePath,
		];
	pinnedImageDigest(params.image);
	for (const value of [
		params.fixturePath,
		params.databaseRoot,
		params.outputPath,
	]) {
		if (!path.isAbsolute(value) || /[,\0\r\n]/.test(value))
			throw new Error("osv_fixture_mount_path_invalid");
	}
	return [
		"docker",
		"run",
		"--rm",
		"--network",
		"none",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--pids-limit",
		"128",
		"--user",
		`${process.getuid?.() ?? 65532}:${process.getgid?.() ?? 65532}`,
		"--env",
		"HOME=/tmp",
		"--env",
		"OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=/database",
		"--mount",
		`type=bind,src=${params.fixturePath},dst=/fixture,readonly`,
		"--mount",
		`type=bind,src=${params.databaseRoot},dst=/database,readonly`,
		"--mount",
		`type=bind,src=${path.dirname(params.outputPath)},dst=/output`,
		"--entrypoint",
		"/osv-scanner",
		params.image,
		...args,
		`/output/${path.basename(params.outputPath)}`,
		"--recursive",
		"/fixture",
	];
}
