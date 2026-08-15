import { describe, expect, it, vi } from "vitest";
import { readAppEnv } from "../../../app/env";
import type { AuthenticatedIntegrationClient } from "../../integrationClients/integration-client.service";
import { NightworkersWorkspaceTargetGrantService } from "./nightworkers-workspace-target-grant.service";
import type { CapturedWorkspaceTargetState } from "./nightworkers-workspace-target-state";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SCAN_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const COMMON_DIGEST = `sha256:${"c".repeat(64)}` as `sha256:${string}`;
const STATE_DIGEST = `sha256:${"d".repeat(64)}` as `sha256:${string}`;
const HEAD = "b".repeat(40);
const TARGET_DIGEST = "e".repeat(64);
const NOW = new Date("2026-08-15T01:00:00.000Z");

const client = {
	id: CLIENT_ID,
	ownerUserId: OWNER_ID,
	scopes: [
		"nightworkers:security-scan:read",
		"nightworkers:security-scan:write",
	],
	allowedRoots: ["/workspace"],
	rateLimitPolicy: { limit: 100, windowMs: 60_000 },
} as unknown as AuthenticatedIntegrationClient;

function state(
	path: string,
	overrides: Partial<CapturedWorkspaceTargetState> = {},
): CapturedWorkspaceTargetState {
	return {
		canonicalWorkspacePath: path,
		gitCommonDirDigest: COMMON_DIGEST,
		headSha: HEAD,
		targetDigest: TARGET_DIGEST,
		workspaceStateDigest: STATE_DIGEST,
		fileCount: 1,
		...overrides,
	};
}

function target() {
	return {
		schemaVersion: 1 as const,
		kind: "working_tree" as const,
		requested: { kind: "working_tree" as const, includeUntracked: true },
		projectPrefix: "",
		baseSha: HEAD,
		headSha: null,
		mergeBaseSha: null,
		includeUntracked: true,
		targetDigest: TARGET_DIGEST,
		snapshotDigest: null,
		changedFileCount: 1,
		scannableFileCount: 1,
	};
}

function grantRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "grant-row-1",
		grantRef: `siwg:v1:${"1".repeat(64)}`,
		grantDigest: `sha256:${"1".repeat(64)}`,
		integrationClientId: CLIENT_ID,
		ownerUserId: OWNER_ID,
		projectId: PROJECT_ID,
		workspaceSubjectRef: "evidence-subject:1",
		canonicalWorkspacePath: "/workspace/task",
		expectedGitCommonDirDigest: COMMON_DIGEST,
		expectedHeadSha: HEAD,
		providerWorkspaceStateDigest: STATE_DIGEST,
		previewRef: `siwp:v1:${"2".repeat(64)}`,
		previewSelection: { mode: "preset", presetId: "standard" },
		previewTargetDigest: TARGET_DIGEST,
		previewSourceRevision: HEAD,
		previewWorkspaceStateDigest: STATE_DIGEST,
		previewExpiresAt: new Date("2026-08-15T01:04:00.000Z"),
		consumedRequestHash: null,
		consumedScanRunId: null,
		consumedAt: null,
		revision: 2,
		expiresAt: new Date("2026-08-15T01:05:00.000Z"),
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function setup(options: {
	enabled?: boolean;
	registeredState?: ReturnType<typeof state>;
	workspaceState?: ReturnType<typeof state>;
	grant?: ReturnType<typeof grantRow> | null;
} = {}) {
	const env = readAppEnv({
		NIGHTWORKERS_INTEGRATION_ALLOWED_PROFILES: "diff-basic-security",
		NIGHTWORKERS_SECURITY_INTELLIGENCE_ALLOWED_PROJECT_IDS: PROJECT_ID,
		NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_ENABLED:
			options.enabled === false ? "false" : "true",
	});
	const registeredState = options.registeredState ?? state("/workspace/project");
	const workspaceState = options.workspaceState ?? state("/workspace/task");
	const captureState = vi.fn(async ({ workspacePath }: { workspacePath: string }) =>
		workspacePath === "/workspace/project" ? registeredState : workspaceState,
	);
	const create = vi.fn(async (input) => ({ id: "created", ...input }));
	const savePreview = vi.fn(async () => grantRow({ revision: 2 }));
	const consumeAndCreateScan = vi.fn(async (_input: Record<string, unknown>) => ({
		resourceId: SCAN_ID,
		replayed: false,
	}));
	let currentGrant = options.grant === undefined ? grantRow() : options.grant;
	const findForClient = vi.fn(async () => currentGrant);
	const launch = vi.fn(async () => undefined);
	const service = new NightworkersWorkspaceTargetGrantService({
		env,
		projectRepository: {
			findById: vi.fn(async () => ({
				id: PROJECT_ID,
				ownerUserId: OWNER_ID,
				repoPath: "/workspace/project",
				canonicalRepoPath: "/workspace/project",
			})),
		} as never,
		scanRepository: {
			findById: vi.fn(async () => ({
				id: SCAN_ID,
				projectId: PROJECT_ID,
				profile: "diff-basic-security",
				status: "queued",
				createdByUserId: OWNER_ID,
				metadata: {
					workspaceTargetGrantRef: grantRow().grantRef,
					expectedTargetDigest: TARGET_DIGEST,
					target: target(),
					executionPolicy: { runner: "host" },
				},
				createdAt: NOW,
			})),
		} as never,
		grantRepository: {
			create,
			findForClient,
			savePreview,
			consumeAndCreateScan,
		} as never,
		scanSupervisor: { launch } as never,
		captureState: captureState as never,
		planBuilder: vi.fn(async () => ({
			profileRef: "diff-basic-security",
			target: target(),
			fileCount: 1,
			state: workspaceState,
		})),
		now: () => NOW,
	});
	return {
		service,
		create,
		savePreview,
		consumeAndCreateScan,
		findForClient,
		launch,
		setGrant(value: ReturnType<typeof grantRow>) {
			currentGrant = value;
		},
	};
}

describe("NightworkersWorkspaceTargetGrantService", () => {
	it("creates a short-lived path-redacted grant for the same Git common directory", async () => {
		const harness = setup();
		const result = await harness.service.createGrant(client, {
			version: 1,
			providerProjectRef: PROJECT_ID,
			workspaceSubjectRef: "evidence-subject:1",
			workspacePath: "/workspace/task",
			expectedGitCommonDirDigest: COMMON_DIGEST,
			expectedHeadSha: HEAD,
		});
		expect(result.providerProjectRef).toBe(PROJECT_ID);
		expect(result.providerWorkspaceStateDigest).toBe(STATE_DIGEST);
		expect(JSON.stringify(result)).not.toContain("/workspace");
		expect(harness.create).toHaveBeenCalledWith(
			expect.objectContaining({
				canonicalWorkspacePath: "/workspace/task",
				projectId: PROJECT_ID,
			}),
		);
	});

	it("rejects another Git common directory, wrong HEAD, and disabled grants", async () => {
		await expect(
			setup({
				workspaceState: state("/workspace/task", {
					gitCommonDirDigest: `sha256:${"f".repeat(64)}`,
				}),
			}).service.createGrant(client, {
				version: 1,
				providerProjectRef: PROJECT_ID,
				workspaceSubjectRef: "evidence-subject:1",
				workspacePath: "/workspace/task",
				expectedGitCommonDirDigest: COMMON_DIGEST,
				expectedHeadSha: HEAD,
			}),
		).rejects.toMatchObject({ code: "project_path_denied" });

		await expect(
			setup().service.createGrant(client, {
				version: 1,
				providerProjectRef: PROJECT_ID,
				workspaceSubjectRef: "evidence-subject:1",
				workspacePath: "/workspace/task",
				expectedGitCommonDirDigest: COMMON_DIGEST,
				expectedHeadSha: "a".repeat(40),
			}),
		).rejects.toMatchObject({ code: "target_digest_mismatch" });

		await expect(
			setup({ enabled: false }).service.createGrant(client, {
				version: 1,
				providerProjectRef: PROJECT_ID,
				workspaceSubjectRef: "evidence-subject:1",
				workspacePath: "/workspace/task",
				expectedGitCommonDirDigest: COMMON_DIGEST,
				expectedHeadSha: HEAD,
			}),
		).rejects.toMatchObject({ code: "provider_temporarily_unavailable" });
	});

	it("keeps preview non-consuming and rejects state drift or expiry", async () => {
		const harness = setup();
		const result = await harness.service.preview(
			client,
			grantRow().grantRef,
			{ version: 1, selection: { mode: "preset", presetId: "standard" } },
		);
		expect(result.target.digest).toBe(TARGET_DIGEST);
		expect(harness.savePreview).toHaveBeenCalledTimes(1);
		expect(harness.consumeAndCreateScan).not.toHaveBeenCalled();

		await expect(
			setup({
				workspaceState: state("/workspace/task", {
					workspaceStateDigest: `sha256:${"f".repeat(64)}`,
				}),
			}).service.preview(client, grantRow().grantRef, {
				version: 1,
				selection: { mode: "preset", presetId: "standard" },
			}),
		).rejects.toMatchObject({ code: "target_digest_mismatch" });

		await expect(
			setup({
				grant: grantRow({
					expiresAt: new Date("2026-08-15T00:59:59.000Z"),
				}),
			}).service.preview(client, grantRow().grantRef, {
				version: 1,
				selection: { mode: "preset", presetId: "standard" },
			}),
		).rejects.toMatchObject({ code: "preview_expired" });
	});

	it("consumes once, replays the same start, and rejects a different reuse", async () => {
		const harness = setup();
		const request = {
			version: 1 as const,
			previewRef: grantRow().previewRef!,
			selection: { mode: "preset" as const, presetId: "standard" as const },
			expectedTargetDigest: TARGET_DIGEST,
		};
		const first = await harness.service.start(
			client,
			grantRow().grantRef,
			request,
			"idempotency-1",
		);
		expect(first.replayed).toBe(false);
		expect(harness.launch).toHaveBeenCalledWith(
			SCAN_ID,
			expect.arrayContaining([
				"--workspace-target-grant-ref",
				grantRow().grantRef,
			]),
		);
		const consumedRequestHash =
			harness.consumeAndCreateScan.mock.calls[0]![0].requestHash;
		harness.setGrant(
			grantRow({
				consumedAt: NOW,
				consumedScanRunId: SCAN_ID,
				consumedRequestHash,
			}),
		);
		const replay = await harness.service.start(
			client,
			grantRow().grantRef,
			request,
			"idempotency-1",
		);
		expect(replay.replayed).toBe(true);
		expect(harness.launch).toHaveBeenCalledTimes(2);

		await expect(
			harness.service.start(
				client,
				grantRow().grantRef,
				{ ...request, expectedTargetDigest: "f".repeat(64) },
				"idempotency-2",
			),
		).rejects.toMatchObject({ code: "idempotency_conflict" });
	});

	it("retries launching a consumed queued scan after a transient spawn failure", async () => {
		const harness = setup();
		const request = {
			version: 1 as const,
			previewRef: grantRow().previewRef!,
			selection: { mode: "preset" as const, presetId: "standard" as const },
			expectedTargetDigest: TARGET_DIGEST,
		};
		harness.launch.mockRejectedValueOnce(new Error("spawn failed"));

		await expect(
			harness.service.start(
				client,
				grantRow().grantRef,
				request,
				"idempotency-1",
			),
		).rejects.toThrow("spawn failed");
		const consumedRequestHash =
			harness.consumeAndCreateScan.mock.calls[0]![0].requestHash;
		harness.setGrant(
			grantRow({
				consumedAt: NOW,
				consumedScanRunId: SCAN_ID,
				consumedRequestHash,
			}),
		);

		const replay = await harness.service.start(
			client,
			grantRow().grantRef,
			request,
			"idempotency-1",
		);
		expect(replay.replayed).toBe(true);
		expect(harness.launch).toHaveBeenCalledTimes(2);
	});
});
