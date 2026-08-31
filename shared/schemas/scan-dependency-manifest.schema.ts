import { z } from "zod";

export const scanDependencyKindSchema = z.enum([
	"container_image",
	"host_binary",
	"docker_daemon",
	"platform",
	"process_service",
	"artifact_store",
	"credential_provider",
	"runtime_target",
	"network_port",
	"filesystem",
]);

export const scanDependencyProbeIdSchema = z.enum([
	"docker_daemon_info",
	"container_image_inspect",
	"container_entrypoint_dry_run",
	"host_binary_version",
	"process_health",
	"artifact_round_trip",
	"credential_metadata",
	"runtime_health",
	"network_port_lease",
	"filesystem_read_write",
	"platform_match",
]);

export const scanDependencyManifestEntrySchema = z
	.object({
		id: z
			.string()
			.regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
			.max(160),
		kind: scanDependencyKindSchema,
		requirement: z.enum(["required", "required_if_applicable", "advisory"]),
		probeId: scanDependencyProbeIdSchema,
		configurationSource: z.discriminatedUnion("kind", [
			z
				.object({
					kind: z.literal("built_in"),
					valueRef: z.string().min(1).max(200),
				})
				.strict(),
			z
				.object({
					kind: z.literal("runtime_setting"),
					settingKey: z.string().min(1).max(200),
				})
				.strict(),
			z
				.object({
					kind: z.literal("generated_resource"),
					factoryId: z.string().min(1).max(200),
				})
				.strict(),
		]),
		platforms: z
			.array(
				z.enum(["linux/amd64", "linux/arm64", "darwin/arm64", "darwin/x64"]),
			)
			.min(1)
			.max(4),
	})
	.strict();

export const scanDependencyManifestSchema = z
	.object({
		schemaVersion: z.literal(1),
		entries: z.array(scanDependencyManifestEntrySchema).min(1).max(128),
	})
	.superRefine((value, ctx) => {
		const ids = new Set<string>();
		for (const [index, entry] of value.entries.entries()) {
			if (ids.has(entry.id)) {
				ctx.addIssue({
					code: "custom",
					path: ["entries", index, "id"],
					message: "Dependency IDs must be unique.",
				});
			}
			ids.add(entry.id);
		}
	});

export type ScanDependencyManifest = z.infer<
	typeof scanDependencyManifestSchema
>;
