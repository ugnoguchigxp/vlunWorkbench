import { describe, expect, it } from "vitest";
import type { ScanProfile } from "../../api";
import scanDependencies from "../../../../shared/manifests/scan-dependencies.v1.json";
import {
	getProfileHelp,
	getScannerHelpItem,
	SCANNER_HELP_ITEMS,
} from "./scan-profile-help";

function profile(overrides: Partial<ScanProfile> = {}): ScanProfile {
	return {
		id: "source-assurance",
		name: "ソースセキュリティ保証",
		description: "リポジトリ全体を確認します。",
		enabled: true,
		defaultTimeoutSec: 600,
		tools: [],
		steps: [],
		...overrides,
	};
}

describe("scan profile help", () => {
	it("documents every scanner dependency bundled by the project", () => {
		const documentedIds = SCANNER_HELP_ITEMS.map((item) => item.id);
		expect(documentedIds).toEqual([
			"semgrep",
			"gitleaks",
			"osv",
			"trivy",
			"zizmor",
			"cosign",
			"slsa-verifier",
			"nuclei",
			"zap",
			"schemathesis",
		]);
		const manifestScannerIds = scanDependencies.entries
			.map((entry) => entry.id)
			.filter((id) => id.startsWith("scanner."))
			.map((id) => id.replace(/^scanner\./, ""))
			.sort();
		expect([...documentedIds].sort()).toEqual(manifestScannerIds);
		for (const item of SCANNER_HELP_ITEMS) {
			expect(item.target.length).toBeGreaterThan(20);
			expect(item.detects.length).toBeGreaterThan(0);
			expect(item.characteristics.length).toBeGreaterThan(0);
		}
	});

	it("explains Semgrep as an optional source-code SAST scanner", () => {
		const semgrep = getScannerHelpItem("semgrep");

		expect(semgrep.category).toContain("SAST");
		expect(semgrep.target).toContain("ソースコード");
		expect(semgrep.characteristics.join(" ")).toContain("任意アダプター");
	});

	it("maps a known profile to its exact target and scanners", () => {
		const help = getProfileHelp(profile());

		expect(help.target).toContain("リポジトリ全体");
		expect(help.scanners.map((item) => item.id)).toEqual([
			"gitleaks",
			"osv",
			"trivy",
			"zizmor",
			"semgrep",
		]);
	});

	it("derives useful fallback help for a future catalog profile", () => {
		const help = getProfileHelp(
			profile({
				id: "future-profile",
				description: "将来追加された検査です。",
				supportedTargets: ["working_tree", "commit"],
				capabilityRequirements: [
					{ capabilityId: "source_sast", requirement: "required" },
					{ capabilityId: "source_sast", requirement: "advisory" },
				],
			}),
		);

		expect(help.target).toBe("作業ツリーの変更、指定コミット");
		expect(help.checks).toEqual(["将来追加された検査です。"]);
		expect(help.scanners).toEqual([{ id: "semgrep" }]);
	});
});
