import { afterEach, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadMavenResolutionConfig } from "../maven/maven-resolution-config";
import { resolveMavenDependencies } from "./maven-resolver-runner";

const temporaryPaths: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryPaths.splice(0).map((entry) =>
			fs.rm(entry, { recursive: true, force: true }),
		),
	);
});

describe("Maven resolver", () => {
	it("rejects a cache under the target before creating it", async () => {
		const repositoryPath = await fs.mkdtemp(
			path.join(os.tmpdir(), "maven-resolver-target-"),
		);
		temporaryPaths.push(repositoryPath);
		await fs.writeFile(path.join(repositoryPath, "pom.xml"), "<project />");
		const targetCachePath = path.join(repositoryPath, ".cache");

		await expect(
			resolveMavenDependencies({
				scanRunId: "scan-123",
				repoPath: repositoryPath,
				resolverImage: "maven-resolver:test",
				resolverImageId: `sha256:${"a".repeat(64)}`,
				execution: {
					runner: "docker",
					docker: { toolCacheDir: targetCachePath },
				},
			}),
		).rejects.toThrow("maven_resolver_cache_inside_target_repository");

		await expect(fs.stat(targetCachePath)).rejects.toThrow();
	});

	it("rejects a cache symlink that resolves under the target", async () => {
		const repositoryPath = await fs.mkdtemp(
			path.join(os.tmpdir(), "maven-resolver-target-"),
		);
		const outsidePath = await fs.mkdtemp(
			path.join(os.tmpdir(), "maven-resolver-outside-"),
		);
		temporaryPaths.push(repositoryPath, outsidePath);
		await fs.writeFile(path.join(repositoryPath, "pom.xml"), "<project />");
		const targetCachePath = path.join(repositoryPath, "cache-target");
		await fs.mkdir(targetCachePath);
		const linkedCachePath = path.join(outsidePath, "cache-link");
		await fs.symlink(targetCachePath, linkedCachePath);

		await expect(
			resolveMavenDependencies({
				scanRunId: "scan-123",
				repoPath: repositoryPath,
				resolverImage: "maven-resolver:test",
				resolverImageId: `sha256:${"a".repeat(64)}`,
				execution: {
					runner: "docker",
					docker: { toolCacheDir: linkedCachePath },
				},
			}),
		).rejects.toThrow("maven_resolver_cache_inside_target_repository");
	});

	it("rejects a scan cache namespace symlink that resolves under the target", async () => {
		const repositoryPath = await fs.mkdtemp(
			path.join(os.tmpdir(), "maven-resolver-target-"),
		);
		const outsidePath = await fs.mkdtemp(
			path.join(os.tmpdir(), "maven-resolver-outside-"),
		);
		temporaryPaths.push(repositoryPath, outsidePath);
		await fs.writeFile(path.join(repositoryPath, "pom.xml"), "<project />");
		const targetCachePath = path.join(repositoryPath, "cache-target");
		await fs.mkdir(targetCachePath);
		const sourceDigest = (
			await loadMavenResolutionConfig(repositoryPath)
		).sourceDigest;
		const scanRunId = "scan-123";
		const cacheKey = crypto
			.createHash("sha256")
			.update(`${sourceDigest}\0${scanRunId}`)
			.digest("hex")
			.slice(0, 24);
		const cacheRoot = path.join(
			outsidePath,
			"vuln-workbench-toolbox-cache",
			"maven",
		);
		await fs.mkdir(cacheRoot, { recursive: true });
		await fs.symlink(targetCachePath, path.join(cacheRoot, cacheKey));

		await expect(
			resolveMavenDependencies({
				scanRunId,
				repoPath: repositoryPath,
				resolverImage: "maven-resolver:test",
				resolverImageId: `sha256:${"a".repeat(64)}`,
				execution: {
					runner: "docker",
					docker: { toolCacheDir: outsidePath },
				},
			}),
		).rejects.toThrow("maven_resolver_cache_inside_target_repository");
	});

	it("rejects Maven source changes after preflight before starting Docker", async () => {
		const repositoryPath = await fs.mkdtemp(
			path.join(os.tmpdir(), "maven-resolver-target-"),
		);
		temporaryPaths.push(repositoryPath);
		await fs.writeFile(path.join(repositoryPath, "pom.xml"), "<project />");

		await expect(
			resolveMavenDependencies({
				scanRunId: "scan-123",
				repoPath: repositoryPath,
				resolverImage: "maven-resolver:test",
				resolverImageId: `sha256:${"a".repeat(64)}`,
				expectedSourceDigest: `sha256:${"b".repeat(64)}`,
				execution: { runner: "docker" },
			}),
		).rejects.toThrow("maven_resolution_source_changed");
	});
});
