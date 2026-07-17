import { describe, expect, it, vi } from "vitest";
import {
	emitProjectStructureComparisonTelemetry,
	projectStructureRolloutMode,
	shouldPersistProjectStructure,
	shouldPreferProjectStructureV2,
} from "./rollout";

describe("Project Structure rollout", () => {
	it("defaults invalid and absent configuration to safe dual-write", () => {
		expect(projectStructureRolloutMode()).toBe("dual");
		expect(projectStructureRolloutMode("unexpected")).toBe("dual");
	});

	it("keeps v1 rollback and v2-preferred reads explicit", () => {
		expect(shouldPersistProjectStructure("v1")).toBe(false);
		expect(shouldPersistProjectStructure("dual")).toBe(true);
		expect(shouldPreferProjectStructureV2("dual")).toBe(false);
		expect(shouldPreferProjectStructureV2("v2_preferred")).toBe(true);
	});

	it("accepts the documented v2 alias and emits aggregate-only telemetry", () => {
		expect(projectStructureRolloutMode("v2")).toBe("v2_preferred");
		const info = vi.spyOn(console, "error").mockImplementation(() => undefined);
		emitProjectStructureComparisonTelemetry({
			mode: "dual",
			durationMs: 12,
			v1FileCount: 2,
			v2FileCount: 3,
			v2ResolvedCount: 4,
			v2UnresolvedCount: 1,
			diagnosticCodes: ["resolution_target_missing"],
		});
		const payload = info.mock.calls[0]?.[0];
		expect(payload).toContain('"type":"project_structure_comparison"');
		expect(payload).not.toContain("/project/path");
		info.mockRestore();
	});
});
