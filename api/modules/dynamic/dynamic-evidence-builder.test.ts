import { describe, expect, it } from "vitest";
import { buildDynamicEvidenceDescriptor } from "./dynamic-evidence-builder";

const baseInput = {
	outcome: "passed",
	reason: "completed",
	exitCode: 0,
	stdoutArtifactId: "stdout-id",
	stderrArtifactId: "stderr-id",
	collectedArtifactIds: ["crash-id"],
};

describe("buildDynamicEvidenceDescriptor", () => {
	it("selects the correct evidence artifact for test outcomes", () => {
		expect(
			buildDynamicEvidenceDescriptor({
				...baseInput,
				dynamicKind: "test",
			}),
		).toMatchObject({
			kind: "dynamic-test-log",
			artifactId: "stdout-id",
		});
		expect(
			buildDynamicEvidenceDescriptor({
				...baseInput,
				dynamicKind: "test",
				outcome: "failed",
			}),
		).toMatchObject({
			artifactId: "stderr-id",
		});
	});

	it("describes sanitizer and fuzz outcomes without losing crash evidence", () => {
		expect(
			buildDynamicEvidenceDescriptor({
				...baseInput,
				dynamicKind: "sanitizer",
				outcome: "crashed",
			}),
		).toMatchObject({
			kind: "sanitizer-finding",
			artifactId: "stderr-id",
		});
		expect(
			buildDynamicEvidenceDescriptor({
				...baseInput,
				dynamicKind: "sanitizer",
			}),
		).toMatchObject({
			kind: "dynamic-result",
			artifactId: "stdout-id",
		});
		expect(
			buildDynamicEvidenceDescriptor({
				...baseInput,
				dynamicKind: "fuzz",
				outcome: "crashed",
			}),
		).toMatchObject({
			kind: "fuzz-crash",
			artifactId: "crash-id",
		});
		expect(
			buildDynamicEvidenceDescriptor({
				...baseInput,
				dynamicKind: "fuzz",
				collectedArtifactIds: [],
			}),
		).toMatchObject({
			kind: "dynamic-result",
			artifactId: "stdout-id",
		});
	});
});
