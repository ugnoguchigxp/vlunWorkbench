import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CosignAttestationProvider,
	isCosignVersionSafe,
} from "./cosign-attestation-provider";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Cosign attestation provider", () => {
	it("uses an offline-only command and emits digest-only receipt evidence", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-cosign-"));
		roots.push(root);
		const subjectPath = path.join(root, "subject");
		const bundlePath = path.join(root, "bundle");
		const trustPolicyPath = path.join(root, "key");
		await Promise.all([
			fs.writeFile(subjectPath, "subject"),
			fs.writeFile(bundlePath, "bundle"),
			fs.writeFile(trustPolicyPath, "key"),
		]);
		const commandRunner = vi.fn().mockResolvedValue({ ok: true, exitCode: 0 });
		const provider = new CosignAttestationProvider(
			commandRunner,
			() => new Date("2026-08-21T00:00:00.000Z"),
		);

		const receipt = await provider.verify({ subjectPath, bundlePath, trustPolicyPath });
		expect(commandRunner).toHaveBeenCalledWith(
			expect.objectContaining({
				binary: "cosign",
				args: expect.arrayContaining([
					"verify-blob-attestation",
					"--offline",
					"--new-bundle-format=true",
					"--check-claims=true",
					"slsaprovenance1",
				]),
			}),
		);
		expect(receipt).toMatchObject({ offline: true, verified: true, reasonCode: "verified" });
		expect(receipt.subjectDigest).toMatch(/^sha256:/);
	});

	it("rejects Cosign releases affected by public-key bundle verification bypasses", () => {
		expect(isCosignVersionSafe("GitVersion: v2.6.4")).toBe(false);
		expect(isCosignVersionSafe("GitVersion: v2.6.5")).toBe(true);
		expect(isCosignVersionSafe("GitVersion: v3.1.2")).toBe(false);
		expect(isCosignVersionSafe("GitVersion: v3.1.3")).toBe(true);
		expect(isCosignVersionSafe("GitVersion: v3.1.3-rc.1")).toBe(false);
	});
});
