import { describe, expect, it, vi } from "vitest";
import { emitProjectStructureComparisonTelemetry } from "./rollout";

describe("Project Structure telemetry", () => {
	it("emits aggregate-only telemetry", () => {
		const info = vi.spyOn(console, "error").mockImplementation(() => undefined);
		emitProjectStructureComparisonTelemetry({
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
