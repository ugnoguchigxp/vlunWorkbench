import { describe, expect, it } from "vitest";
import { toProjectRelativePath } from "./path-boundary";

describe("Static Intelligence path boundary", () => {
	it("keeps project-relative paths in POSIX form", () => {
		expect(toProjectRelativePath("/work/repo", "src\\app.ts")).toEqual({
			ok: true,
			path: "src/app.ts",
		});
	});

	it("converts contained absolute paths", () => {
		expect(toProjectRelativePath("/work/repo", "/work/repo/src/app.ts")).toEqual({
			ok: true,
			path: "src/app.ts",
		});
		expect(
			toProjectRelativePath("C:/work/repo", "C:/work/repo/src/app.ts"),
		).toEqual({
			ok: true,
			path: "src/app.ts",
		});
	});

	it("redacts paths outside the project", () => {
		expect(toProjectRelativePath("/work/repo", "/Users/alice/secret.ts")).toEqual({
			ok: false,
			path: "unknown",
			reason: "outside_project",
		});
		expect(toProjectRelativePath("C:\\work\\repo", "D:\\secret.ts")).toEqual({
			ok: false,
			path: "unknown",
			reason: "outside_project",
		});
	});

	it("rejects traversal and empty input", () => {
		expect(toProjectRelativePath("/work/repo", "../secret.ts")).toMatchObject({
			ok: false,
			reason: "outside_project",
		});
		expect(toProjectRelativePath("/work/repo", "")).toMatchObject({
			ok: false,
			reason: "empty_path",
		});
	});

	it("rejects URI and Windows drive-relative inputs", () => {
		expect(toProjectRelativePath("/work/repo", "file:///tmp/secret.ts")).toMatchObject({
			ok: false,
			reason: "invalid_path",
		});
		expect(toProjectRelativePath("/work/repo", "file:/tmp/secret.ts")).toMatchObject({
			ok: false,
			reason: "invalid_path",
		});
		expect(toProjectRelativePath("/work/repo", "src\nsecret.ts")).toMatchObject({
			ok: false,
			reason: "invalid_path",
		});
		expect(toProjectRelativePath("C:\\work\\repo", "C:secret.ts")).toMatchObject({
			ok: false,
			reason: "invalid_path",
		});
	});
});
