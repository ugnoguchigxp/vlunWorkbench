import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyScannerHardeningDod } from "./verify-scanner-hardening-dod";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

test("accepts the exact SH-DOD, SH-CLOSE, RE-DOD, and A-case sets", async () => {
	await expect(verifyScannerHardeningDod()).resolves.toMatchObject({
		parentDodCount: 17,
		parentCloseoutCount: 4,
		remediationDodCount: 21,
		remediationCaseCount: 10,
	});
});

test("rejects superseded remediation outside A1 and A3", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-dod-"));
	roots.push(root);
	const source = path.resolve(
		import.meta.dir,
		"../spec/security-capability/scan-execution-remediation-closeout.v1.json",
	);
	const value = JSON.parse(await fs.readFile(source, "utf8"));
	const a2 = value.cases.find((entry: { id: string }) => entry.id === "A2");
	a2.requiredDisposition = "superseded";
	a2.reason = "real_scan_target_fixed_to_todolist";
	a2.successorContract =
		"spec/security-capability/todolist-scan-target.v1.json";
	const remediationPath = path.join(root, "remediation.json");
	await fs.writeFile(remediationPath, JSON.stringify(value));
	await expect(
		verifyScannerHardeningDod({ remediationPath }),
	).rejects.toThrow();
});
