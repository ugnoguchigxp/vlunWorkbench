import type { ScanTarget, ScanTargetKind } from "../../../api";

export function buildSelectedScanTarget(input: {
	scanTargetKind: ScanTargetKind;
	diffBaseRef: string;
	diffHeadRef: string;
	diffIncludeUntracked: boolean;
}): ScanTarget {
	if (input.scanTargetKind === "full") return { kind: "full" };
	if (input.scanTargetKind === "commit") {
		return {
			kind: "commit",
			head: input.diffHeadRef.trim(),
			...(input.diffBaseRef.trim() ? { base: input.diffBaseRef.trim() } : {}),
		};
	}
	if (input.scanTargetKind === "range") {
		return {
			kind: "range",
			base: input.diffBaseRef.trim(),
			head: input.diffHeadRef.trim(),
		};
	}
	return {
		kind: "working_tree",
		...(input.diffBaseRef.trim() ? { base: input.diffBaseRef.trim() } : {}),
		includeUntracked: input.diffIncludeUntracked,
	};
}
