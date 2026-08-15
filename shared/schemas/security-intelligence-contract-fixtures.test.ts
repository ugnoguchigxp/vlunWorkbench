import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseNightworkersSecurityIntelligenceBundle,
} from "./nightworkers-security-intelligence.schema";
import {
  deriveProviderWorkspaceTargetGrant,
  parseProviderWorkspaceTargetGrant,
  parseSecurityIntelligenceBindingProof,
} from "./nightworkers-security-intelligence-binding.schema";
import {
  securityIntelligenceIdentityFixtureSchema,
  SECURITY_INTELLIGENCE_IDENTITY_FIXTURE_SHA256,
} from "./security-intelligence-identity-mapping.schema";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  );
}

describe("Security Intelligence participant fixtures", () => {
  it("interprets the shared identity and redaction fixture", () => {
    const input = fixture("security-intelligence-identity-v1.json");
    const parsed = securityIntelligenceIdentityFixtureSchema.parse(input);
    const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    expect(`sha256:${digest}`).toBe(SECURITY_INTELLIGENCE_IDENTITY_FIXTURE_SHA256);
    expect(parsed.workingTree.scanStartSourceRevisionRole).toBe("base_revision");
    expect(parsed.workingTree.assessmentSourceRevisionRole).toBe("assessed_revision");
    expect(parsed.failureReasonCategories).toContain("absolute_path_forbidden");
    expect(parsed.failureReasonCategories).toContain("secret_like_value_forbidden");
  });

  it("freezes the start, binding proof, and assessment triple", () => {
    const triple = fixture("security-intelligence-scan-binding-v2.json") as {
      startResponse: {
        scanRunRef: string;
        target: { digest: string; sourceRevision: string };
      };
      bindingProof: unknown;
    };
    const proof = parseSecurityIntelligenceBindingProof(triple.bindingProof);
    const envelope = fixture("nightworkers-security-intelligence-v1.json") as {
      data: unknown;
    };
    const bundle = parseNightworkersSecurityIntelligenceBundle(envelope.data);
    expect(triple.startResponse.scanRunRef).toBe(proof.rawScanRunRef);
    expect(triple.startResponse.target.sourceRevision).toBe(
      proof.target.baseRevision,
    );
    expect(bundle.target.sourceRevision).toBe(proof.target.assessedRevision);
    expect(triple.startResponse.target.digest).toBe(proof.target.rawTargetDigest);
    expect(bundle.target.targetDigest).toBe(proof.target.canonicalTargetDigest);
    expect(proof.target.baseRevision).not.toBe(proof.target.assessedRevision);
  });

  it("rejects proof identity and digest mismatches", () => {
    const triple = fixture("security-intelligence-scan-binding-v2.json") as {
      bindingProof: Record<string, unknown>;
    };
    const wrongProject = structuredClone(triple.bindingProof) as {
      canonicalProjectRef: string;
    };
    wrongProject.canonicalProjectRef =
      "project:99999999-9999-4999-8999-999999999999";
    expect(() => parseSecurityIntelligenceBindingProof(wrongProject)).toThrow();

    const wrongDigest = structuredClone(triple.bindingProof) as {
      target: { canonicalTargetDigest: string };
    };
    wrongDigest.target.canonicalTargetDigest = `sha256:${"f".repeat(64)}`;
    expect(() => parseSecurityIntelligenceBindingProof(wrongDigest)).toThrow();
  });

  it("verifies workspace grant integrity and accepts SHA-256 Git object ids", () => {
    const grant = deriveProviderWorkspaceTargetGrant({
      version: 1,
      providerProjectRef: "11111111-1111-4111-8111-111111111111",
      workspaceSubjectRef: "provider-workspace:1",
      expectedGitCommonDirDigest: `sha256:${"c".repeat(64)}`,
      expectedHeadSha: "a".repeat(64),
      providerWorkspaceStateDigest: `sha256:${"d".repeat(64)}`,
      expiresAt: "2026-08-15T01:05:00.000Z",
    });
    expect(parseProviderWorkspaceTargetGrant(grant)).toEqual(grant);

    const tampered = { ...grant, expectedHeadSha: "b".repeat(64) };
    expect(() => parseProviderWorkspaceTargetGrant(tampered)).toThrow(
      "workspace_grant_digest_mismatch",
    );
  });

  it("rejects absolute paths in an assessment target", () => {
    const envelope = fixture("nightworkers-security-intelligence-v1.json") as {
      data: { target: { sourceRevision: string } };
    };
    envelope.data.target.sourceRevision = "/Users/private/worktree";
    expect(() =>
      parseNightworkersSecurityIntelligenceBundle(envelope.data),
    ).toThrow();
  });
});
