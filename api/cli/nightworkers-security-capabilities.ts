import crypto from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import { integrationCapabilitiesSchema } from "../../shared/schemas/nightworkers-security-scan-integration.schema";
import { readAppEnv } from "../app/env";
import {
	listNightworkersPresets,
	listNightworkersSelectableProfiles,
} from "../modules/integrations/nightworkers/nightworkers-scan-preset-registry";

export function buildNightworkersCliCapabilities(
	projectPath: string,
	allowedProfileRefs: readonly string[],
) {
	const canonicalPath = path.resolve(projectPath);
	return integrationCapabilitiesSchema.parse({
		provider: { id: "vulnworkbench", version: "cli-2" },
		project: {
			ref: `local-cli-${crypto.createHash("sha256").update(canonicalPath).digest("hex").slice(0, 24)}`,
			displayName: path.basename(canonicalPath) || canonicalPath,
		},
		presets: listNightworkersPresets(allowedProfileRefs),
		selectableProfiles: listNightworkersSelectableProfiles(allowedProfileRefs),
		limits: {
			maxConcurrentScansForClient: 1,
			maxFindingPageSize: 100,
			maxEventPageSize: 1,
			maxReportBytes: 5 * 1024 * 1024,
		},
	});
}

async function main() {
	let projectPath: string | undefined;
	try {
		projectPath = parseArgs({
			args: process.argv.slice(2),
			options: { "project-path": { type: "string" } },
			strict: true,
		}).values["project-path"];
	} catch (error) {
		console.log(
			JSON.stringify({
				ok: false,
				status: "config_error",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		return 2;
	}
	if (!projectPath) {
		console.log(
			JSON.stringify({
				ok: false,
				status: "config_error",
				message: "Missing required argument: --project-path is required.",
			}),
		);
		return 2;
	}
	try {
		const env = readAppEnv();
		console.log(
			JSON.stringify(
				buildNightworkersCliCapabilities(
					projectPath,
					env.nightworkersIntegrationAllowedProfiles,
				),
			),
		);
		return 0;
	} catch (error) {
		console.log(
			JSON.stringify({
				ok: false,
				status: "config_error",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		return 2;
	}
}

if (import.meta.main) process.exitCode = await main();
