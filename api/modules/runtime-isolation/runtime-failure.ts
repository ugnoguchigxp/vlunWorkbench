import { redactSecrets } from "../scans/normalizers/redaction";
import type { RuntimeBundleRole } from "./docker-runtime-bundle";

export type RuntimeBundlePhase =
	| "projection"
	| "workspace"
	| "dependency_install"
	| "target_start"
	| "readiness"
	| "evidence"
	| "cleanup";

export type RuntimeDockerOperation =
	| "volume_create"
	| "network_create"
	| "network_connect"
	| "create"
	| "start"
	| "wait"
	| "stop"
	| "exec"
	| "dispose";

export type RuntimeFailureReasonCode =
	| "runtime_target_process_exited"
	| "runtime_target_readiness_timeout"
	| "runtime_dependency_install_failed"
	| "runtime_bind_mount_unavailable"
	| "runtime_resource_exhausted"
	| "runtime_container_create_failed"
	| "runtime_target_unavailable"
	| "runtime_evidence_collection_failed"
	| "runtime_cleanup_failed"
	| "runtime_target_session_disposed"
	| "runtime_execution_failed";

export type RuntimeFailureEvidence = {
	schemaVersion: 1;
	bundleId: string;
	stepId: string;
	rootFailure: {
		reasonCode: RuntimeFailureReasonCode;
		phase: RuntimeBundlePhase;
		role: RuntimeBundleRole | null;
		operation: RuntimeDockerOperation;
		exitCode: number | null;
	};
	containers: Array<{
		role: RuntimeBundleRole;
		status: string | null;
		exitCode: number | null;
		oomKilled: boolean | null;
		stdout: string;
		stderr: string;
		truncated: boolean;
	}>;
	readiness: {
		timeoutMs: number;
		attempts: number;
		paths: Array<{ path: string; lastResult: string }>;
	} | null;
	redacted: true;
};

export class RuntimeDockerCommandError extends Error {
	readonly name = "RuntimeDockerCommandError";
	constructor(
		readonly input: {
			reasonCode: RuntimeFailureReasonCode;
			phase: RuntimeBundlePhase;
			role: RuntimeBundleRole | null;
			operation: RuntimeDockerOperation;
			exitCode: number | null;
			terminationReason: string | null;
			stderr: string;
			stdout: string;
		},
	) {
		super(`${input.reasonCode}:${input.operation}`);
	}

	get safeExcerpt(): string | null {
		return (
			safeRuntimeText(this.input.stderr || this.input.stdout, 4096) || null
		);
	}
}

export class RuntimeTargetPreparationError extends Error {
	readonly name = "RuntimeTargetPreparationError";
	readonly cleanupFailure: RuntimeDockerCommandError | null;
	readonly evidence: RuntimeFailureEvidence | null;

	constructor(
		readonly input: {
			reasonCode: RuntimeFailureReasonCode;
			phase: RuntimeBundlePhase;
			role: RuntimeBundleRole | null;
			operation: RuntimeDockerOperation;
			exitCode: number | null;
			terminationReason: string | null;
			safeExcerpt: string | null;
			evidence?: RuntimeFailureEvidence | null;
			diagnosticArtifactIds?: string[];
			cleanupFailure?: RuntimeDockerCommandError | null;
		},
	) {
		super(input.safeExcerpt ?? input.reasonCode);
		this.evidence = input.evidence ?? null;
		this.cleanupFailure = input.cleanupFailure ?? null;
	}

	get diagnosticArtifactIds(): string[] {
		return this.input.diagnosticArtifactIds ?? [];
	}

	attachDiagnosticArtifactIds(ids: string[]): this {
		this.input.diagnosticArtifactIds = [...new Set(ids)];
		return this;
	}

	withDiagnosticArtifactIds(ids: string[]): RuntimeTargetPreparationError {
		return new RuntimeTargetPreparationError({
			...this.input,
			diagnosticArtifactIds: ids,
		});
	}

	static fromUnknown(error: unknown): RuntimeTargetPreparationError {
		if (error instanceof RuntimeTargetPreparationError) return error;
		if (error instanceof RuntimeDockerCommandError) {
			return new RuntimeTargetPreparationError({
				reasonCode: error.input.reasonCode,
				phase: error.input.phase,
				role: error.input.role,
				operation: error.input.operation,
				exitCode: error.input.exitCode,
				terminationReason: error.input.terminationReason,
				safeExcerpt: error.safeExcerpt,
			});
		}
		return new RuntimeTargetPreparationError({
			reasonCode: "runtime_execution_failed",
			phase: "target_start",
			role: null,
			operation: "create",
			exitCode: null,
			terminationReason: null,
			safeExcerpt: safeRuntimeText(
				error instanceof Error ? error.message : String(error),
				4096,
			),
		});
	}
}

export function safeRuntimeText(value: string, maxBytes: number): string {
	const redacted = redactSecrets(value)
		.replaceAll(/\/Users\/[^\s"'`)]+/g, "<redacted-path>")
		.replaceAll(/\/home\/[^\s"'`)]+/g, "<redacted-path>")
		.replaceAll(/[A-Za-z]:\\Users\\[^\s"'`)]+/g, "<redacted-path>");
	return Buffer.from(redacted, "utf8").subarray(0, maxBytes).toString("utf8");
}
