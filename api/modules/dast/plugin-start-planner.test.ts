import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	inferDastTargetStartPlan,
	prepareDastTargetWorkspace,
} from "./target-preparer";

describe("plugin DAST start planner", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-plugin-start-"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("requires explicit consent for a Maven Spring start plan", async () => {
		await write(
			"pom.xml",
			"<project><dependency>org.springframework.boot:spring-boot-starter-web</dependency><build><plugins><plugin><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>",
		);
		await write(
			"src/main/java/example/App.java",
			"package example; @SpringBootApplication class App {}",
		);
		await write("mvnw", "#!/bin/sh\n");

		await expect(
			inferDastTargetStartPlan({ repoPath: root, port: 18080 }),
		).rejects.toThrow("project_code_execution_consent_required");

		const plan = await inferDastTargetStartPlan({
			repoPath: root,
			port: 18080,
			consentProjectCodeExecution: true,
		});
		expect(plan).toMatchObject({
			pluginId: "framework.java.spring",
			packageManager: "maven",
			command: ["./mvnw", "--offline", "spring-boot:run"],
			requiresProjectCodeConsent: true,
			origin: "http://127.0.0.1:18080",
		});
		expect(plan.env).toEqual({
			SERVER_ADDRESS: "127.0.0.1",
			SERVER_PORT: "18080",
		});

		let spawnCalled = false;
		await expect(
			prepareDastTargetWorkspace({
				repoPath: root,
				port: 18080,
				consentProjectCodeExecution: true,
				spawn: () => {
					spawnCalled = true;
					return {
						exited: Promise.resolve(0),
						kill: () => undefined,
					};
				},
			}),
		).rejects.toThrow("project_code_execution_sandbox_required");
		expect(spawnCalled).toBe(false);
	});

	it("does not invent a Spring Boot command for a Spring MVC WAR", async () => {
		await write(
			"pom.xml",
			"<project><packaging>war</packaging><dependency>org.springframework:spring-webmvc</dependency></project>",
		);
		await write(
			"src/main/java/example/Controller.java",
			'package example; @Controller class Controller { @RequestMapping("/") void index() {} }',
		);
		await write("mvnw", "#!/bin/sh\n");

		await expect(
			inferDastTargetStartPlan({
				repoPath: root,
				port: 18080,
				consentProjectCodeExecution: true,
			}),
		).rejects.toThrow("no registered framework start plan");
	});

	it("produces an offline Gradle plan without executing or mutating Gradle", async () => {
		await write(
			"build.gradle",
			"plugins { id 'org.springframework.boot' version '3.4.0' }",
		);
		await write(
			"src/main/java/example/App.java",
			"package example; @SpringBootApplication class App {}",
		);
		await write("gradlew", "#!/bin/sh\nexit 99\n");
		const before = await snapshot();

		const plan = await inferDastTargetStartPlan({
			repoPath: root,
			port: 19090,
			consentProjectCodeExecution: true,
		});

		expect(plan).toMatchObject({
			pluginId: "framework.java.spring",
			packageManager: "gradle",
			command: ["./gradlew", "--offline", "--no-daemon", "bootRun"],
		});
		expect(await snapshot()).toEqual(before);
	});

	it("validates a Python FastAPI plan but fails closed before project execution", async () => {
		await write(
			"app.py",
			'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/health")\ndef health(): return {"ok": True}\n',
		);
		await write("requirements.txt", "fastapi==0.116.1\nuvicorn==0.35.0\n");

		await expect(
			inferDastTargetStartPlan({ repoPath: root, port: 20123 }),
		).rejects.toThrow("project_code_execution_consent_required");

		const plan = await inferDastTargetStartPlan({
			repoPath: root,
			port: 20123,
			consentProjectCodeExecution: true,
		});
		expect(plan).toMatchObject({
			pluginId: "framework.python.fastapi",
			packageManager: "python",
			command: [
				"python3",
				"-m",
				"uvicorn",
				"app:app",
				"--host",
				"127.0.0.1",
				"--port",
				"20123",
			],
			requiresProjectCodeConsent: true,
			origin: "http://127.0.0.1:20123",
		});

		let spawnCalled = false;
		await expect(
			prepareDastTargetWorkspace({
				repoPath: root,
				port: 20123,
				consentProjectCodeExecution: true,
				spawn: () => {
					spawnCalled = true;
					return { exited: Promise.resolve(0), kill: () => undefined };
				},
			}),
		).rejects.toThrow("project_code_execution_sandbox_required");
		expect(spawnCalled).toBe(false);
	});

	it("rejects ambiguous Python framework start plans", async () => {
		await write(
			"app.py",
			[
				"from fastapi import FastAPI",
				"from flask import Flask",
				"api = FastAPI()",
				"web = Flask(__name__)",
			].join("\n"),
		);

		await expect(
			inferDastTargetStartPlan({
				repoPath: root,
				port: 20123,
				consentProjectCodeExecution: true,
			}),
		).rejects.toThrow("dast_start_plan_ambiguous");
	});

	it("prefers a framework plan over a lower-priority npm start script", async () => {
		await write(
			"package.json",
			JSON.stringify({ scripts: { start: "node server.js" } }),
		);
		await write("server.ts", "export const server = true;\n");
		await write(
			"app.py",
			"from fastapi import FastAPI\napi = FastAPI()\n",
		);

		const plan = await inferDastTargetStartPlan({
			repoPath: root,
			port: 20123,
			consentProjectCodeExecution: true,
		});
		expect(plan).toMatchObject({
			pluginId: "framework.python.fastapi",
			scriptName: "fastapi",
			script:
				"-m uvicorn app:api --host 127.0.0.1 --port 20123",
		});
	});

	async function write(relativePath: string, content: string): Promise<void> {
		const filePath = path.join(root, relativePath);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, content);
	}

	async function snapshot(): Promise<string[]> {
		const output: string[] = [];
		const walk = async (directory: string) => {
			for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
				const entryPath = path.join(directory, entry.name);
				if (entry.isDirectory()) await walk(entryPath);
				else output.push(path.relative(root, entryPath));
			}
		};
		await walk(root);
		return output.sort((left, right) => left.localeCompare(right));
	}
});
