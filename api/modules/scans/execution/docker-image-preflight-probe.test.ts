import { describe, expect, it, vi } from "vitest";
import {
	type DockerProbeCommandRunner,
	probeDockerImageWithRecovery,
} from "./docker-image-preflight-probe";

const image = "vuln-workbench-toolbox:local";
const imageId = `sha256:${"a".repeat(64)}`;
const probeOptions = {
	containerNameFactory: () => "vwb-preflight-wake-test",
};

describe("Docker image preflight", () => {
	it("wakes Resource Saver without starting image code and reinspects", async () => {
		const runner = vi
			.fn<DockerProbeCommandRunner>()
			.mockResolvedValueOnce({
				exitCode: 1,
				stderr: `No such image: ${image}`,
			})
			.mockResolvedValueOnce({ exitCode: 0, stdout: "container-id\n" })
			.mockResolvedValueOnce({ exitCode: 0 })
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: `[]\t${imageId}\tlinux/arm64\n`,
			});

		const result = await probeDockerImageWithRecovery(
			"docker",
			image,
			runner,
			probeOptions,
		);

		expect(result).toMatchObject({
			ready: true,
			imageId,
			platform: "linux/arm64",
			reasonCode: null,
		});
		expect(runner).toHaveBeenCalledTimes(4);
		expect(runner.mock.calls[0]?.[1]).toEqual([
			"image",
			"inspect",
			"--format",
			expect.any(String),
			"--",
			image,
		]);
		expect(runner.mock.calls[1]?.[1][0]).toBe("create");
		expect(runner.mock.calls[1]?.[1]).not.toContain("run");
		expect(runner.mock.calls[1]?.[1]).toEqual(
			expect.arrayContaining([
				"--pull=never",
				"--network",
				"none",
				"--cap-drop",
				"ALL",
				"--security-opt",
				"no-new-privileges",
				"--read-only",
			]),
		);
		expect(runner.mock.calls[1]?.[1].slice(-2)).toEqual(["--", image]);
		expect(runner.mock.calls[2]).toEqual([
			"docker",
			[
				"container",
				"rm",
				"--force",
				"--",
				"vwb-preflight-wake-test",
			],
			10,
		]);
		expect(runner.mock.calls[3]?.[1]).toEqual(runner.mock.calls[0]?.[1]);
	});

	it("keeps the local image identity and platform", async () => {
		const runner = vi.fn<DockerProbeCommandRunner>(async () => ({
			exitCode: 0,
			stdout: `[]\t${imageId}\tlinux/arm64\n`,
		}));

		await expect(
			probeDockerImageWithRecovery("docker", image, runner),
		).resolves.toMatchObject({
			ready: true,
			imageId,
			platform: "linux/arm64",
			reasonCode: null,
		});
	});

	it("keeps a genuinely missing image classified as unavailable", async () => {
		const runner = vi
			.fn<DockerProbeCommandRunner>()
			.mockResolvedValueOnce({
				exitCode: 1,
				stderr: `Error response from daemon: No such image: ${image}`,
			})
			.mockResolvedValueOnce({
				exitCode: 1,
				stderr: `Error response from daemon: No such image: ${image}`,
			})
			.mockResolvedValueOnce({
				exitCode: 1,
				stderr:
					"Error response from daemon: No such container: vwb-preflight-wake-test",
			})
			.mockResolvedValueOnce({
				exitCode: 1,
				stderr: `Error response from daemon: No such image: ${image}`,
			});

		await expect(
			probeDockerImageWithRecovery("docker", image, runner, probeOptions),
		).resolves.toMatchObject({
			ready: false,
			reasonCode: "docker_image_unavailable",
		});
		expect(runner).toHaveBeenCalledTimes(4);
	});

	it("classifies an unreachable daemon separately", async () => {
		const runner = vi.fn<DockerProbeCommandRunner>(async () => ({
			ok: false,
			exitCode: null,
			stderr:
				"Cannot connect to the Docker daemon. Is the docker daemon running?",
		}));

		await expect(
			probeDockerImageWithRecovery("docker", image, runner, probeOptions),
		).resolves.toMatchObject({
			ready: false,
			reasonCode: "docker_daemon_unavailable",
		});
		expect(runner).toHaveBeenCalledTimes(1);
	});

	it("cleans up after a timed-out create before accepting the retry", async () => {
		const runner = vi
			.fn<DockerProbeCommandRunner>()
			.mockResolvedValueOnce({
				exitCode: 1,
				stderr: `No such image: ${image}`,
			})
			.mockResolvedValueOnce({
				ok: false,
				exitCode: null,
				error: "docker execution timed out",
			})
			.mockResolvedValueOnce({ exitCode: 0 })
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: `[]\t${imageId}\tlinux/arm64\n`,
			});

		await expect(
			probeDockerImageWithRecovery("docker", image, runner, probeOptions),
		).resolves.toMatchObject({ ready: true, reasonCode: null });
		expect(runner.mock.calls[2]?.[1]?.slice(0, 3)).toEqual([
			"container",
			"rm",
			"--force",
		]);
	});

	it("fails closed when the transient container cannot be removed", async () => {
		const runner = vi
			.fn<DockerProbeCommandRunner>()
			.mockResolvedValueOnce({
				exitCode: 1,
				stderr: `No such image: ${image}`,
			})
			.mockResolvedValueOnce({ exitCode: 0, stdout: "container-id\n" })
			.mockResolvedValueOnce({ exitCode: 1, stderr: "cleanup failed" })
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: `[]\t${imageId}\tlinux/arm64\n`,
			});

		await expect(
			probeDockerImageWithRecovery("docker", image, runner, probeOptions),
		).resolves.toMatchObject({
			ready: false,
			reasonCode: "docker_daemon_unavailable",
		});
	});
});
