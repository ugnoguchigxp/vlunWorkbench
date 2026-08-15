import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const image = process.argv[2] ?? "vuln-workbench-toolbox:local";
const goVersion = "1.26.6";
const trivyVersion = "0.72.0";
const trivySourceCommit = "8a32853686209a428179bb3a1688802b25691564";
const trivySourceSha256 =
	"5a922c388846d11345ce8283e4373be312458f002abc667c3cd1f77c43163725";

const goChecksums: Record<string, string> = {
	"darwin-amd64":
		"08b65a63f244115121ced6c3b55ad38d801a7442acad5c949a17aad84ae6d684",
	"darwin-arm64":
		"2dc95ce4675829f2df0e86b28bcef3283635902062a5f0580ca659bf570f3204",
	"linux-amd64":
		"708effb774be8237570d0add163225abbdfaf4fca28b2611df167beba4feef89",
	"linux-arm64":
		"d0507e9e9d7fe012aae570108cbd76c15de879e17130ab8cb90d4d7445cb1f2e",
};

async function run(
	command: string[],
	options: { cwd?: string; env?: Record<string, string | undefined> } = {},
) {
	const proc = Bun.spawn(command, {
		cwd: options.cwd,
		env: options.env ?? process.env,
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`${command[0]} exited with code ${exitCode}`);
	}
}

async function sha256(filePath: string) {
	const hash = createHash("sha256");
	hash.update(await readFile(filePath));
	return hash.digest("hex");
}

async function downloadVerified(
	url: string,
	outputPath: string,
	expectedSha256: string,
) {
	try {
		await access(outputPath);
		if ((await sha256(outputPath)) === expectedSha256) return;
		await rm(outputPath, { force: true });
	} catch {
		// Download below.
	}

	let lastError: unknown;
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		const partialPath = `${outputPath}.partial`;
		try {
			await run([
				"curl",
				"-fsSL",
				"--retry",
				"5",
				"--retry-all-errors",
				"--connect-timeout",
				"15",
				"--max-time",
				"300",
				"-o",
				partialPath,
				url,
			]);
			const actualSha256 = await sha256(partialPath);
			if (actualSha256 !== expectedSha256) {
				throw new Error(
					`checksum mismatch for ${path.basename(outputPath)}: ${actualSha256}`,
				);
			}
			await rename(partialPath, outputPath);
			return;
		} catch (error) {
			lastError = error;
			await rm(partialPath, { force: true });
			if (attempt < 5) {
				await Bun.sleep(attempt * 1_000);
			}
		}
	}
	throw lastError;
}

if (process.platform !== "darwin" && process.platform !== "linux") {
	throw new Error(`unsupported toolbox build OS: ${process.platform}`);
}
if (process.arch !== "arm64" && process.arch !== "x64") {
	throw new Error(`unsupported toolbox build architecture: ${process.arch}`);
}
const hostOs = process.platform;
const hostArch = process.arch === "arm64" ? "arm64" : "amd64";
const hostKey = `${hostOs}-${hostArch}`;
const goChecksum = goChecksums[hostKey];
if (!goChecksum) {
	throw new Error(`unsupported toolbox build host: ${hostKey}`);
}
const defaultPlatform = process.env.DOCKER_DEFAULT_PLATFORM;
const targetArch = defaultPlatform
	? defaultPlatform === "linux/arm64"
		? "arm64"
		: defaultPlatform === "linux/amd64"
			? "amd64"
			: null
	: hostArch;
if (!targetArch) {
	throw new Error(
		`unsupported DOCKER_DEFAULT_PLATFORM: ${defaultPlatform}; expected linux/amd64 or linux/arm64`,
	);
}

const audit = Bun.spawn(
	["bun", "run", "scripts/audit-nuclei-safe-templates.ts"],
	{
		stdout: "inherit",
		stderr: "inherit",
		env: process.env,
	},
);
const auditExitCode = await audit.exited;
if (auditExitCode !== 0) process.exit(auditExitCode);

const cacheRoot = path.join(os.tmpdir(), "vuln-workbench-toolbox-build-cache");
const workRoot = await mkdtemp(
	path.join(os.tmpdir(), "vuln-workbench-toolbox-build-"),
);

try {
	await mkdir(cacheRoot, { recursive: true });
	const goAsset = `go${goVersion}.${hostOs}-${hostArch}.tar.gz`;
	const goArchive = path.join(cacheRoot, goAsset);
	const trivyArchive = path.join(
		cacheRoot,
		`trivy-${trivySourceCommit}.tar.gz`,
	);
	await downloadVerified(`https://go.dev/dl/${goAsset}`, goArchive, goChecksum);
	await downloadVerified(
		`https://codeload.github.com/aquasecurity/trivy/tar.gz/${trivySourceCommit}`,
		trivyArchive,
		trivySourceSha256,
	);

	const toolchainRoot = path.join(workRoot, "toolchain");
	const sourceRoot = path.join(workRoot, "source");
	const binaryRoot = path.join(workRoot, "binary");
	const scannerDataRoot = path.join(workRoot, "scanner-data");
	await mkdir(toolchainRoot);
	await mkdir(sourceRoot);
	await mkdir(binaryRoot);
	await run(["bun", "run", "scripts/prepare-scanner-data.ts", scannerDataRoot]);
	await run(["tar", "-xzf", goArchive, "-C", toolchainRoot]);
	await run([
		"tar",
		"-xzf",
		trivyArchive,
		"-C",
		sourceRoot,
		"--strip-components=1",
	]);

	const goBinary = path.join(toolchainRoot, "go", "bin", "go");
	const goEnv = {
		...process.env,
		CGO_ENABLED: "0",
		GOARCH: targetArch,
		GOOS: "linux",
		GOTOOLCHAIN: "local",
		GOEXPERIMENT: "jsonv2",
		GOCACHE: path.join(workRoot, "go-build"),
		GOMODCACHE: path.join(cacheRoot, "go-mod"),
	};
	await run(
		[
			goBinary,
			"get",
			"github.com/containerd/containerd/v2@v2.3.2",
			"github.com/go-git/go-git/v5@v5.19.2",
			"google.golang.org/grpc@v1.82.1",
			"golang.org/x/net@v0.56.0",
			"golang.org/x/text@v0.39.0",
			"oras.land/oras-go/v2@v2.6.2",
		],
		{ cwd: sourceRoot, env: goEnv },
	);
	await run(
		[
			goBinary,
			"build",
			"-trimpath",
			"-buildvcs=false",
			"-ldflags",
			`-s -w -X github.com/aquasecurity/trivy/pkg/version/app.ver=${trivyVersion}`,
			"-o",
			path.join(binaryRoot, "trivy"),
			"./cmd/trivy",
		],
		{ cwd: sourceRoot, env: goEnv },
	);

	await run([
		"docker",
		"build",
		"--platform",
		`linux/${targetArch}`,
		"--build-context",
		`trivy-binary=${binaryRoot}`,
		"--build-context",
		`scanner-data=${scannerDataRoot}`,
		"-t",
		image,
		"-f",
		"docker/toolbox/Dockerfile",
		".",
	]);
	console.log(`Built ${image}`);
} finally {
	await rm(workRoot, { recursive: true, force: true });
}
