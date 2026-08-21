import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	executeCloseoutCommand,
	runScannerHardeningCloseout,
	scannerHardeningCloseoutExitCode,
} from "./scanner-hardening-closeout";

const roots: string[] = [];

afterAll(async () => {
	await Promise.all(
		roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

describe("scanner hardening closeout runner", () => {
	test("rejects an unbound implementation commit before creating a run", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-closeout-"));
		roots.push(root);
		await expect(
			runScannerHardeningCloseout({
				implementationCommit: "0".repeat(40),
				outputRoot: root,
			}),
		).rejects.toThrow("scanner_hardening_closeout_commit_mismatch");
		expect(await fs.readdir(root)).toEqual([]);
	});

	test("maps every documented failure class to a stable exit code", () => {
		expect(scannerHardeningCloseoutExitCode(new Error("scanner_hardening_closeout_args_required"))).toBe(2);
		expect(scannerHardeningCloseoutExitCode(new Error("scanner_hardening_closeout_dirty_checkout"))).toBe(3);
		expect(scannerHardeningCloseoutExitCode(new Error("scanner_hardening_closeout_command_failed:scanner-e2e"))).toBe(5);
		expect(scannerHardeningCloseoutExitCode(new Error("scanner_hardening_closeout_command_failed:failure"))).toBe(6);
		expect(scannerHardeningCloseoutExitCode(new Error("scanner_hardening_closeout_command_failed:verify-strict"))).toBe(7);
		expect(scannerHardeningCloseoutExitCode(new Error("scanner_hardening_closeout_resource_leak"))).toBe(8);
		expect(scannerHardeningCloseoutExitCode(new Error("scanner_hardening_closeout_ci_receipt_digest_mismatch"))).toBe(9);
		expect(scannerHardeningCloseoutExitCode(new Error("scanner_hardening_closeout_command_failed:dod-verify"))).toBe(4);
	});

	test("captures command output without Bun child pipes", async () => {
		const result = await executeCloseoutCommand("scope", [
			process.execPath,
			"-e",
			'process.stdout.write("closeout-out"); process.stderr.write("closeout-err");',
		]);
		expect(result.exitCode).toBe(0);
		expect(Buffer.from(result.stdout).toString("utf8")).toBe("closeout-out");
		expect(Buffer.from(result.stderr).toString("utf8")).toBe("closeout-err");
	});

	test("fails closed when a command exceeds its output bound", async () => {
		const result = await executeCloseoutCommand(
			"scope",
			[process.execPath, "-e", 'process.stdout.write("x".repeat(4096));'],
			{ maxLogBytes: 128 },
		);
		expect(result.exitCode).toBe(125);
		expect(result.stdout.byteLength + result.stderr.byteLength).toBe(128);
		expect(result.stdout.byteLength).toBeLessThan(128);
		expect(Buffer.from(result.stderr).toString("utf8")).toContain(
			"scanner_hardening_closeout_output_limit",
		);
	});

	test("fails closed when a command exceeds its deadline", async () => {
		const result = await executeCloseoutCommand(
			"scope",
			[process.execPath, "-e", "setInterval(() => {}, 1_000);"],
			{ timeoutMs: 25 },
		);
		expect(result.exitCode).toBe(124);
		expect(Buffer.from(result.stderr).toString("utf8")).toContain(
			"scanner_hardening_closeout_timeout",
		);
	});
});
