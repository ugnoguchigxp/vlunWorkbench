import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAttestationInputPaths } from "./attestation-inputs";

describe("attestation input paths", () => {
	let root = "";
	afterEach(async () => {
		if (root) await fs.rm(root, { recursive: true, force: true });
	});

	it("accepts files inside the repository and rejects traversal", async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-attestation-input-"));
		await fs.mkdir(path.join(root, "security"));
		await Promise.all([
			fs.writeFile(path.join(root, "subject.bin"), "subject"),
			fs.writeFile(path.join(root, "bundle.json"), "{}"),
			fs.writeFile(path.join(root, "security", "cosign.pub"), "key"),
		]);
		const resolved = await resolveAttestationInputPaths({
			repoPath: root,
			subject: "subject.bin",
			bundle: "bundle.json",
			trustPolicy: "security/cosign.pub",
		});
		expect(resolved.subjectPath).toBe(
			await fs.realpath(path.join(root, "subject.bin")),
		);
		await expect(
			resolveAttestationInputPaths({
				repoPath: root,
				subject: "../outside",
				bundle: "bundle.json",
				trustPolicy: "security/cosign.pub",
			}),
		).rejects.toThrow("attestation_input_outside_repository");
	});
});
