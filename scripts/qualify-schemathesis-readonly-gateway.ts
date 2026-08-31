import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const image =
	process.env.VULN_WORKBENCH_TOOLBOX_IMAGE ?? "vuln-workbench-toolbox:local";
const qualificationScript = path.resolve(
	process.cwd(),
	"scripts/qualify-schemathesis-readonly-gateway.py",
);

const mountQualificationRoot = await fs.mkdtemp(
	path.join(os.tmpdir(), "vwb-schemathesis-policy-mount-"),
);
try {
	await fs.chmod(mountQualificationRoot, 0o700);
	const policyPath = path.join(mountQualificationRoot, "policy.json");
	await fs.writeFile(
		policyPath,
		JSON.stringify({
			schemaVersion: 1,
			authHeaders: { Authorization: "Bearer mount-permission-canary" },
		}),
		{ encoding: "utf8", mode: 0o644 },
	);
	const permissionCheck = Bun.spawn(
		[
			"docker",
			"run",
			"--rm",
			"--network",
			"none",
			"--read-only",
			"--user",
			"65532:65532",
			"--mount",
			`type=bind,src=${policyPath},dst=/workspace/inputs/policy.json,readonly`,
			image,
			"/opt/schemathesis/bin/python",
			"-c",
			'import json; from pathlib import Path; policy=json.loads(Path("/workspace/inputs/policy.json").read_text()); assert policy["authHeaders"]["Authorization"]',
		],
		{ stdout: "inherit", stderr: "inherit" },
	);
	const permissionExitCode = await permissionCheck.exited;
	if (permissionExitCode !== 0) {
		throw new Error(
			`schemathesis_policy_mount_qualification_failed:${permissionExitCode}`,
		);
	}
} finally {
	await fs.rm(mountQualificationRoot, { recursive: true, force: true });
}

const child = Bun.spawn(
	[
		"docker",
		"run",
		"--rm",
		"--network",
		"none",
		"--read-only",
		"--workdir",
		"/tmp",
		"--env",
		"HOME=/tmp",
		"--tmpfs",
		"/tmp:rw,nosuid,nodev,size=128m,mode=1777",
		"--mount",
		`type=bind,src=${qualificationScript},dst=/qualification.py,readonly`,
		image,
		"/opt/schemathesis/bin/python",
		"/qualification.py",
	],
	{ stdout: "inherit", stderr: "inherit" },
);

const exitCode = await child.exited;
if (exitCode !== 0) {
	throw new Error(
		`schemathesis_readonly_gateway_qualification_failed:${exitCode}`,
	);
}
