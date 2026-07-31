import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { buildProjectStructureSnapshot } from "./builder";

describe("Java project structure analyzer", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-java-structure-"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("classifies Java as source and resolves package imports", async () => {
		await write(
			"pom.xml",
			"<project><modelVersion>4.0.0</modelVersion></project>",
		);
		await write(
			"src/main/java/com/example/service/OrderService.java",
			`package com.example.service;
public class OrderService {}`,
		);
		await write(
			"src/main/java/com/example/web/OrderController.java",
			`package com.example.web;
import com.example.service.OrderService;
@RestController
public class OrderController {
  private final OrderService service = new OrderService();
}`,
		);

		const snapshot = await buildProjectStructureSnapshot({
			projectPath: root,
			generatedAt: new Date("2026-07-31T00:00:00.000Z"),
		});

		expect(snapshot.summary.analyzedFileCount).toBeGreaterThanOrEqual(2);
		expect(
			snapshot.files.find((file) => file.path.endsWith("OrderController.java")),
		).toMatchObject({
			analyzerId: "java-source",
			language: "java",
			status: "analyzed",
		});
		expect(
			snapshot.references.find(
				(reference) =>
					reference.specifier === "com.example.service.OrderService",
			),
		).toMatchObject({
			status: "resolved",
			target: "src/main/java/com/example/service/OrderService.java",
		});
		expect(
			snapshot.inventory.entries.find((entry) =>
				entry.path.endsWith("OrderController.java"),
			)?.kind,
		).toBe("source");
	});

	async function write(relativePath: string, content: string): Promise<void> {
		const filePath = path.join(root, relativePath);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, content);
	}
});
