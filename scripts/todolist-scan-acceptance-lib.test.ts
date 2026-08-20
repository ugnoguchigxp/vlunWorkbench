import { describe, expect, it } from "vitest";
import path from "node:path";
import {
	resolveTodolistAcceptanceTarget,
	selectTodolistAcceptanceProfiles,
} from "./todolist-scan-acceptance-lib";

describe("todolist scanner acceptance target", () => {
	it("uses the dedicated todolist repository and its fixed individual matrix", async () => {
		const target = await resolveTodolistAcceptanceTarget(
			path.resolve(process.cwd(), "..", "todolist"),
		);
		expect(target.repoPath).toContain(`${path.sep}todolist`);
		expect(typeof target.commit).toBe("string");
		expect(selectTodolistAcceptanceProfiles([]).map((profile) => profile.id)).toEqual([
			"gitleaks",
			"osv",
			"trivy-fs",
			"sbom",
			"schemathesis-no-schema",
			"nuclei-safe",
			"zap-baseline",
			"trivy-image",
		]);
	});

	it("rejects an unknown scanner selector instead of silently skipping it", () => {
		expect(() => selectTodolistAcceptanceProfiles(["unknown"])).toThrow(
			"todolist_acceptance_profile_unknown:unknown",
		);
	});
});
