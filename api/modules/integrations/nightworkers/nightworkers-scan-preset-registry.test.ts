import { describe, expect, it } from "bun:test";
import {
	listNightworkersPresets,
	resolveNightworkersProfile,
} from "./nightworkers-scan-preset-registry";

const allowed = [
	"source-baseline",
	"diff-source-baseline",
	"diff-basic-security",
	"basic-security",
	"detailed-security",
];

describe("NightWorkers scan preset registry", () => {
	it("maps stable presets by target without mapping deep to runtime scans", () => {
		const presets = listNightworkersPresets(allowed);
		expect(
			presets
				.find((preset) => preset.id === "standard")
				?.targets.find((target) => target.kind === "working_tree")
				?.profileRef,
		).toBe("diff-basic-security");
		expect(
			presets
				.find((preset) => preset.id === "deep")
				?.targets.map((target) => target.kind),
		).toEqual(["full"]);
		expect(
			presets
				.find((preset) => preset.id === "deep")
				?.targets[0]?.profileRef,
		).toBe("detailed-security");
	});

	it("rejects unsupported and non-allowlisted selections", () => {
		expect(() =>
			resolveNightworkersProfile({
				selection: { mode: "preset", presetId: "deep" },
				targetKind: "working_tree",
				allowedProfileRefs: allowed,
			}),
		).toThrow("does not support");
		expect(() =>
			resolveNightworkersProfile({
				selection: { mode: "custom", profileRef: "full-security-scan" },
				targetKind: "full",
				allowedProfileRefs: allowed,
			}),
		).toThrow("not allowed");
	});
});
