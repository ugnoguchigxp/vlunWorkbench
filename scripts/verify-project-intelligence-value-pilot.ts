import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
	assertSealedPilotRegistration,
	hashText,
	parseStrictJson,
	sanitizeProjectIntelligenceValuePilot,
} from "./project-intelligence-value-pilot-contract";

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			raw: { type: "string" },
			registration: { type: "string" },
			output: { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	const rawPath = requiredPath("--raw", args.values.raw);
	const registrationPath = requiredPath(
		"--registration",
		args.values.registration,
	);
	const outputPath = requiredPath("--output", args.values.output);
	const [rawText, registrationText] = await Promise.all([
		readFile(rawPath, "utf8"),
		readFile(registrationPath, "utf8"),
	]);
	// Registration is an input to the decision and must receive the same strict
	// duplicate-key treatment as the report before its fingerprint is trusted.
	assertSealedPilotRegistration(parseStrictJson(registrationText));
	const report = sanitizeProjectIntelligenceValuePilot({
		rawText,
		preRegistrationHash: hashText(registrationText),
	});
	await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(
		`${JSON.stringify({
			decision: report.decision,
			rawEvidenceHash: report.rawEvidenceHash,
			output: outputPath,
		})}\n`,
	);
}

function requiredPath(option: string, value: string | undefined) {
	if (!value?.trim()) throw new Error(`${option} is required.`);
	return path.resolve(value);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
