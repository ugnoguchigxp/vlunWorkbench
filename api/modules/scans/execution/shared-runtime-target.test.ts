import { describe, expect, it, vi } from "vitest";
import { RuntimeTargetSession } from "./shared-runtime-target";

describe("RuntimeTargetSession", () => {
	it("performs one preparation attempt and reuses its typed failure", async () => {
		const prepare = vi.fn().mockRejectedValue(new Error("target did not become ready"));
		const session = new RuntimeTargetSession({
			repoPath: "/projection",
			consentProjectCodeExecution: true,
			runtimeTargetProvider: { prepare } as never,
		});

		await expect(session.ensure()).rejects.toThrow("target did not become ready");
		await expect(session.ensure()).rejects.toMatchObject({
			message: "target did not become ready",
		});
		expect(session.getFailure()?.input.reasonCode).toBe("runtime_execution_failed");
		session.getFailure()?.attachDiagnosticArtifactIds(["artifact-1"]);
		expect(session.getFailure()?.diagnosticArtifactIds).toEqual(["artifact-1"]);
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(session.getState()).toBe("failed");
		await session.dispose();
	});
});
