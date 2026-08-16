import { describe, expect, test } from "bun:test";
import { runPhase55StrictEntryPrerequisites } from "./phase-55-entry-lib";

describe("Phase 55 strict entry orchestration", () => {
	test("runs baseline verification before the full Phase 54 closeout", async () => {
		const calls: string[] = [];
		await runPhase55StrictEntryPrerequisites({
			platform: "linux",
			entryReportExists: false,
			verifyBaseline: async () => {
				calls.push("baseline");
			},
			runPhase54FullCloseout: async () => {
				calls.push("phase54-closeout");
			},
		});
		expect(calls).toEqual([
			"baseline",
			"phase54-closeout",
			"baseline",
		]);
	});

	test("does not run closeout when baseline verification fails", async () => {
		let closeoutRan = false;
		await expect(
			runPhase55StrictEntryPrerequisites({
				platform: "linux",
				entryReportExists: false,
				verifyBaseline: async () => {
					throw new Error("baseline_invalid");
				},
				runPhase54FullCloseout: async () => {
					closeoutRan = true;
				},
			}),
		).rejects.toThrow("baseline_invalid");
		expect(closeoutRan).toBe(false);
	});

	test("propagates a full closeout failure as a failed entry", async () => {
		await expect(
			runPhase55StrictEntryPrerequisites({
				platform: "linux",
				entryReportExists: false,
				verifyBaseline: async () => {},
				runPhase54FullCloseout: async () => {
					throw new Error("phase_54_closeout_failed");
				},
			}),
		).rejects.toThrow("phase_54_closeout_failed");
	});

	test("rejects baseline drift detected after the full closeout", async () => {
		let verificationCount = 0;
		await expect(
			runPhase55StrictEntryPrerequisites({
				platform: "linux",
				entryReportExists: false,
				verifyBaseline: async () => {
					verificationCount += 1;
					if (verificationCount === 2) throw new Error("baseline_drifted");
				},
				runPhase54FullCloseout: async () => {},
			}),
		).rejects.toThrow("baseline_drifted");
	});

	test("rejects non-Linux and reused entry evidence before mutation", async () => {
		const noOp = async () => {};
		await expect(
			runPhase55StrictEntryPrerequisites({
				platform: "darwin",
				entryReportExists: false,
				verifyBaseline: noOp,
				runPhase54FullCloseout: noOp,
			}),
		).rejects.toThrow("phase_55_entry_requires_linux");
		await expect(
			runPhase55StrictEntryPrerequisites({
				platform: "linux",
				entryReportExists: true,
				verifyBaseline: noOp,
				runPhase54FullCloseout: noOp,
			}),
		).rejects.toThrow("phase_55_entry_report_reuse_rejected");
	});
});
