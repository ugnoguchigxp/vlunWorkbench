import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	classifyDynamicExecutionFailure,
	type DynamicArtifactCollectionLimits,
	getDynamicRunMetadata,
	resolveDynamicArtifactLimits,
	resolveDynamicNetworkMode,
	resolveDynamicTimeoutSec,
	walkDynamicArtifactFiles,
} from "./dynamic-run-policy";

const generousLimits: DynamicArtifactCollectionLimits = {
	maxFiles: 10,
	maxTotalBytes: 1_000,
	maxFileBytes: 100,
	maxDepth: 5,
	maxEntries: 20,
};

describe("dynamic run policy", () => {
	it("normalizes metadata and classifies execution failure kinds", () => {
		expect(getDynamicRunMetadata({ run: 1 })).toEqual({ run: 1 });
		expect(getDynamicRunMetadata(null)).toEqual({});
		expect(
			classifyDynamicExecutionFailure({ error: "operation timed out" }),
		).toEqual({
			status: "timed_out",
			failureKind: "dynamic_timeout",
		});
		expect(
			classifyDynamicExecutionFailure({
				error: "dynamic_output_limit_exceeded",
			}),
		).toMatchObject({ failureKind: "dynamic_output_limit_exceeded" });
		expect(
			classifyDynamicExecutionFailure({ stderr: "manifest unknown" }),
		).toMatchObject({ failureKind: "docker_image_missing" });
		expect(
			classifyDynamicExecutionFailure({ exitCode: 125 }),
		).toMatchObject({ failureKind: "docker_unavailable" });
		expect(classifyDynamicExecutionFailure({})).toMatchObject({
			failureKind: "unknown_error",
		});
	});

	it("allows only timeout and network policy tightening", () => {
		expect(resolveDynamicTimeoutSec(120)).toBe(120);
		expect(resolveDynamicTimeoutSec(120, 30)).toBe(30);
		expect(() => resolveDynamicTimeoutSec(0)).toThrow("Profile timeout_sec");
		expect(() => resolveDynamicTimeoutSec(120, 0)).toThrow(
			"Requested timeout_sec",
		);
		expect(() => resolveDynamicTimeoutSec(120, 121)).toThrow(
			"exceeds the profile",
		);

		expect(resolveDynamicNetworkMode("default")).toBe("default");
		expect(resolveDynamicNetworkMode("default", "none")).toBe("none");
		expect(resolveDynamicNetworkMode("none")).toBe("none");
		expect(() => resolveDynamicNetworkMode("none", "default")).toThrow(
			"exceeds the profile network policy",
		);
	});

	it("validates artifact collection limit overrides", () => {
		expect(resolveDynamicArtifactLimits({ maxFiles: 3 }).maxFiles).toBe(3);
		expect(() => resolveDynamicArtifactLimits({ maxEntries: 0 })).toThrow(
			"maxEntries must be a positive integer",
		);
		expect(() =>
			resolveDynamicArtifactLimits({ maxFileBytes: 1.5 }),
		).toThrow("maxFileBytes must be a positive integer");
	});

	it("walks regular artifact files and enforces every traversal boundary", async () => {
		const tempDirectory = await fs.mkdtemp(
			path.join(os.tmpdir(), "vuln-workbench-dynamic-policy-"),
		);
		try {
			const nestedDirectory = path.join(tempDirectory, "nested");
			await fs.mkdir(nestedDirectory);
			await fs.writeFile(path.join(tempDirectory, "one.txt"), "12");
			await fs.writeFile(path.join(nestedDirectory, "two.txt"), "34");

			expect(
				(await walkDynamicArtifactFiles(tempDirectory, generousLimits)).sort(),
			).toEqual(["nested/two.txt", "one.txt"]);
			await expect(
				walkDynamicArtifactFiles(tempDirectory, {
					...generousLimits,
					maxDepth: 0,
				}),
			).rejects.toThrow("dynamic_artifact_depth_limit_exceeded");
			await expect(
				walkDynamicArtifactFiles(tempDirectory, {
					...generousLimits,
					maxEntries: 1,
				}),
			).rejects.toThrow("dynamic_artifact_entry_limit_exceeded");
			await expect(
				walkDynamicArtifactFiles(tempDirectory, {
					...generousLimits,
					maxFileBytes: 1,
				}),
			).rejects.toThrow("dynamic_artifact_file_limit_exceeded");
			await expect(
				walkDynamicArtifactFiles(tempDirectory, {
					...generousLimits,
					maxTotalBytes: 3,
				}),
			).rejects.toThrow("dynamic_artifact_total_limit_exceeded");
			await expect(
				walkDynamicArtifactFiles(tempDirectory, {
					...generousLimits,
					maxFiles: 1,
				}),
			).rejects.toThrow("dynamic_artifact_count_limit_exceeded");
		} finally {
			await fs.rm(tempDirectory, { recursive: true, force: true });
		}
	});
});
