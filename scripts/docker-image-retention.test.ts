import { describe, expect, test } from "bun:test";
import {
	retainOnlyScannerE2EPinnedImage,
	scannerE2EPinnedTag,
	staleScannerE2EPinnedTags,
} from "./docker-image-retention";

const imageId = (character: string) => `sha256:${character.repeat(64)}`;

describe("scanner E2E Docker image retention", () => {
	test("derives a stable tag from the immutable image ID", () => {
		expect(scannerE2EPinnedTag(imageId("a"))).toBe(
			`vuln-workbench-scanner-e2e-pinned:${"a".repeat(24)}`,
		);
		expect(() => scannerE2EPinnedTag("latest")).toThrow(
			"scanner_e2e_toolbox_image_id_invalid",
		);
	});

	test("selects only older generated tags from the project repository", () => {
		const keepTag = scannerE2EPinnedTag(imageId("c"));
		expect(
			staleScannerE2EPinnedTags(
				[
					scannerE2EPinnedTag(imageId("b")),
					keepTag,
					scannerE2EPinnedTag(imageId("a")),
					"vuln-workbench-scanner-e2e-pinned:manual",
					"another-project:aaaaaaaaaaaaaaaaaaaaaaaa",
				].join("\n"),
				keepTag,
			),
		).toEqual([
			scannerE2EPinnedTag(imageId("a")),
			scannerE2EPinnedTag(imageId("b")),
		]);
	});

	test("removes stale generated tags after the current tag exists", async () => {
		const keepTag = scannerE2EPinnedTag(imageId("b"));
		const staleTag = scannerE2EPinnedTag(imageId("a"));
		const calls: string[][] = [];
		await retainOnlyScannerE2EPinnedImage({
			keepTag,
			env: {},
			command: async (command) => {
				calls.push(command);
				return {
					exitCode: 0,
					stdout: command.includes("ls") ? `${staleTag}\n${keepTag}\n` : "",
					stderr: "",
				};
			},
		});

		expect(calls).toContainEqual(["docker", "image", "rm", staleTag]);
		expect(
			calls.filter(
				(command) => command[1] === "image" && command[2] === "prune",
			),
		).toHaveLength(2);
		expect(calls.at(-1)).toContain(
			"label=org.opencontainers.image.title=vulnWorkbench optional Semgrep adapter image",
		);
	});
});
