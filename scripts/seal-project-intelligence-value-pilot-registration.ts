import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createSealedPilotRegistration } from "./project-intelligence-value-pilot-contract";

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2).filter((arg) => arg !== "--"),
		options: {
			"pilot-id": { type: "string" },
			"producer-commit": { type: "string" },
			"consumer-commit": { type: "string" },
			"target-commit": { type: "string" },
			"task-set-fingerprint": { type: "string" },
			"evaluator-set-fingerprint": { type: "string" },
			"route-fingerprint": { type: "string" },
			"settings-fingerprint": { type: "string" },
			"prompt-contract-fingerprint": { type: "string" },
			"tool-manifest-fingerprint": { type: "string" },
			"pilot-owner": { type: "string" },
			output: { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	const values = args.values;
	const output = requiredPath("--output", values.output);
	const registration = createSealedPilotRegistration({
		pilotId: required("--pilot-id", values["pilot-id"]),
		commits: {
			producer: required("--producer-commit", values["producer-commit"]),
			consumer: required("--consumer-commit", values["consumer-commit"]),
			target: required("--target-commit", values["target-commit"]),
		},
		fingerprints: {
			taskSet: required(
				"--task-set-fingerprint",
				values["task-set-fingerprint"],
			),
			evaluatorSet: required(
				"--evaluator-set-fingerprint",
				values["evaluator-set-fingerprint"],
			),
			route: required("--route-fingerprint", values["route-fingerprint"]),
			settings: required(
				"--settings-fingerprint",
				values["settings-fingerprint"],
			),
			promptContract: required(
				"--prompt-contract-fingerprint",
				values["prompt-contract-fingerprint"],
			),
			toolManifest: required(
				"--tool-manifest-fingerprint",
				values["tool-manifest-fingerprint"],
			),
		},
		retention: { rawEvidencePolicy: "LOCAL_OWNER_RETAINED" },
		approvals: {
			pilotOwner: required("--pilot-owner", values["pilot-owner"]),
		},
	});
	await writeAtomicJson(output, registration);
	process.stdout.write(
		`${JSON.stringify({ status: registration.status, pilotId: registration.pilotId, output })}\n`,
	);
}

function required(option: string, value: string | undefined) {
	if (!value?.trim()) throw new Error(`${option} is required.`);
	return value.trim();
}

function requiredPath(option: string, value: string | undefined) {
	return path.resolve(required(option, value));
}

async function writeAtomicJson(output: string, value: unknown) {
	await mkdir(path.dirname(output), { recursive: true });
	const temporary = `${output}.tmp-${process.pid}-${Date.now()}`;
	try {
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		try {
			await link(temporary, output);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				throw new Error(
					`Refusing to overwrite an existing registration: ${output}`,
				);
			}
			throw error;
		}
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
