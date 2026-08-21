import { describe, expect, test } from "bun:test";
import { scanScopedAutoTargetName } from "./profile-dast-step-runner";

describe("profile DAST auto target identity", () => {
	test("keeps target configuration history isolated per scan run", () => {
		expect(scanScopedAutoTargetName("todolist", "scan-a")).toBe(
			"todolist [scan:scan-a]",
		);
		expect(scanScopedAutoTargetName("todolist", "scan-b")).not.toBe(
			scanScopedAutoTargetName("todolist", "scan-a"),
		);
	});
});
