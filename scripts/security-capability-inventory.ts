import { execFileSync } from "node:child_process";
import { loadScannerDataManifest } from "../api/modules/scans/tools/scanner-provenance";
import { listDastProfiles } from "../api/modules/dast/profiles";
import { SCAN_PROFILES } from "../api/modules/scans/profiles";

const manifest = await loadScannerDataManifest();
const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
	encoding: "utf8",
}).trim();
const inventory = {
	schemaVersion: 1,
	gitCommit,
	scannerDataManifestHash: manifest.manifestHash,
	scannerDataSnapshotDate: manifest.snapshotDate,
	profiles: SCAN_PROFILES.map((profile) => ({
		id: profile.id,
		category: profile.category,
		enabled: profile.enabled,
		tools: profile.tools.map((tool) => tool.toolId),
		steps: (profile.steps ?? []).map((step) =>
			step.kind === "static_tool"
				? step.toolId
				: step.kind === "dast"
					? `dast:${step.profileId}`
					: `${step.kind}:${step.adapter}`,
		),
	})),
	dastProfiles: listDastProfiles().map((profile) => ({
		id: profile.id,
		kind: profile.kind,
		enabled: profile.enabled,
	})),
	scannerData: Object.fromEntries(
		Object.entries(manifest.tools).map(([toolId, entry]) => [
			toolId,
			{
				version: entry.version,
				state: entry.state,
				digest: entry.digest,
			},
		]),
	),
	workflow: {
		deterministicReport: "automatic",
		llmDiagnosis: "automatic_when_configured",
		humanDecisionRequired: false,
		failureFallback: "ready_with_limitations",
	},
};
console.log(JSON.stringify(inventory, null, 2));
