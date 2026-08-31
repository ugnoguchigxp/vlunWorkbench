import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	parseSlsaVerifierVersion,
	SlsaProvenanceProvider,
} from "./slsa-provenance-provider";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

describe("SLSA provenance provider", () => {
	it("verifies local provenance against explicit source, builder, and ref policy", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-slsa-"));
		roots.push(root);
		const subjectPath = path.join(root, "artifact");
		const provenancePath = path.join(root, "artifact.intoto.jsonl");
		const policyPath = path.join(root, "slsa-policy.json");
		await Promise.all([
			fs.writeFile(subjectPath, "artifact"),
			fs.writeFile(provenancePath, "provenance"),
			fs.writeFile(
				policyPath,
				JSON.stringify({
					schemaVersion: 1,
					sourceUri: "github.com/example/project",
					builderId: "https://github.com/slsa-framework/slsa-github-generator/.github/workflows/builder_go_slsa3.yml@refs/tags/v2.1.0",
					sourceRef: { kind: "tag", value: "v1.2.3" },
				}),
			),
		]);
		const commandRunner = vi.fn().mockResolvedValue({ ok: true, exitCode: 0 });
		const receipt = await new SlsaProvenanceProvider(
			commandRunner,
			() => new Date("2026-08-24T00:00:00.000Z"),
		).verify({ subjectPath, provenancePath, policyPath, timeoutSec: 900 });

		expect(commandRunner).toHaveBeenCalledWith({
			binary: "slsa-verifier",
			timeoutSec: 900,
			args: [
				"verify-artifact",
				subjectPath,
				"--provenance-path",
				provenancePath,
				"--source-uri",
				"github.com/example/project",
				"--builder-id",
				expect.any(String),
				"--source-tag",
				"v1.2.3",
			],
		});
		expect(receipt).toMatchObject({
			provider: "slsa-verifier",
			offline: false,
			verified: true,
			reasonCode: "verified",
		});
	});

	it("rejects malformed policy without invoking the verifier", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-slsa-"));
		roots.push(root);
		const subjectPath = path.join(root, "artifact");
		const provenancePath = path.join(root, "provenance");
		const policyPath = path.join(root, "policy.json");
		await Promise.all([
			fs.writeFile(subjectPath, "artifact"),
			fs.writeFile(provenancePath, "provenance"),
			fs.writeFile(policyPath, JSON.stringify({ schemaVersion: 1 })),
		]);
		const commandRunner = vi.fn();
		const receipt = await new SlsaProvenanceProvider(commandRunner).verify({
			subjectPath,
			provenancePath,
			policyPath,
		});
		expect(commandRunner).not.toHaveBeenCalled();
		expect(receipt).toMatchObject({
			verified: false,
			reasonCode: "slsa_policy_invalid",
			expected: null,
		});
	});

	it("rejects duplicate policy keys", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-slsa-"));
		roots.push(root);
		const subjectPath = path.join(root, "artifact");
		const provenancePath = path.join(root, "provenance");
		const policyPath = path.join(root, "policy.json");
		await Promise.all([
			fs.writeFile(subjectPath, "artifact"),
			fs.writeFile(provenancePath, "provenance"),
			fs.writeFile(
				policyPath,
				'{"schemaVersion":1,"sourceUri":"good","sourceUri":"shadowed"}',
			),
		]);
		const commandRunner = vi.fn();
		const receipt = await new SlsaProvenanceProvider(commandRunner).verify({
			subjectPath,
			provenancePath,
			policyPath,
		});

		expect(commandRunner).not.toHaveBeenCalled();
		expect(receipt.reasonCode).toBe("slsa_policy_invalid");
	});

	it("parses the pinned verifier version", () => {
		expect(parseSlsaVerifierVersion("GitVersion: 2.7.1")).toBe("2.7.1");
		expect(parseSlsaVerifierVersion("unknown")).toBeNull();
	});
});
