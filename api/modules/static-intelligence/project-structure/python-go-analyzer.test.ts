import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildProjectStructureSnapshot } from "./builder";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

describe("Python and Go project structure analyzers", () => {
	it("classifies Python sources and conservatively resolves relative and src-layout imports", async () => {
		const root = await fixture({
			"pkg/__init__.py": "",
			"pkg/service.py": "def run():\n    return 1\n",
			"pkg/app.py": "from . import service\nclass App:\n    pass\n",
			"src/acme/__init__.py": "",
			"src/acme/util.py": "def helper():\n    pass\n",
			"src/acme/main.py": "import acme.util\nasync def start():\n    pass\n",
		});

		const snapshot = await buildProjectStructureSnapshot({ projectPath: root });

		expect(snapshot.files.find((file) => file.path === "pkg/app.py")).toMatchObject({
			language: "python",
			analyzerId: "python-source",
			exportedSymbols: ["App"],
		});
		expect(snapshot.references).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					from: "pkg/app.py",
					specifier: ".",
					target: "pkg/__init__.py",
					status: "resolved",
				}),
				expect.objectContaining({
					from: "src/acme/main.py",
					specifier: "acme.util",
					target: "src/acme/util.py",
					status: "resolved",
				}),
			]),
		);
	});

	it("blocks Python relative imports above the project root and ignores main guards in strings", async () => {
		const root = await fixture({
			"service.py": "def run():\n    return 1\n",
			"pkg/app.py": "from ... import service\n",
			"notes.py": 'EXAMPLE = \'\'\'\nif __name__ == "__main__":\n    run()\n\'\'\'\n',
		});

		const snapshot = await buildProjectStructureSnapshot({ projectPath: root });

		expect(
			snapshot.references.find(
				(reference) =>
					reference.from === "pkg/app.py" &&
					reference.specifier === "...service",
			),
		).toMatchObject({
			status: "blocked",
			diagnosticCodes: ["resolution_target_outside_root"],
		});
		expect(
			snapshot.files.find((file) => file.path === "notes.py")?.tags,
		).not.toContain("handler");
	});

	it("classifies Go source facts and resolves only imports inside the nearest module", async () => {
		const root = await fixture({
			"go.mod": "module example.com/acme/app\n\ngo 1.24\n",
			"cmd/server/main.go":
				'package main\nimport (\n "fmt"\n "example.com/acme/app/internal/httpapi"\n)\nfunc main() { fmt.Println(httpapi.Name) }\n',
			"internal/httpapi/server.go": "package httpapi\nconst Name = \"server\"\n",
			"internal/httpapi/server_test.go": "package httpapi\nfunc TestServer() {}\n",
		});

		const snapshot = await buildProjectStructureSnapshot({ projectPath: root });

		expect(snapshot.files.find((file) => file.path === "cmd/server/main.go")).toMatchObject({
			language: "go",
			analyzerId: "go-source",
			tags: expect.arrayContaining(["handler", "source"]),
		});
		expect(snapshot.files.find((file) => file.path.endsWith("server_test.go"))?.tags).toContain(
			"test",
		);
		expect(snapshot.references).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					specifier: "fmt",
					kind: "runtime_builtin",
					status: "external",
				}),
				expect.objectContaining({
					specifier: "example.com/acme/app/internal/httpapi",
					target: "internal/httpapi/server.go",
					status: "resolved",
				}),
			]),
		);
	});

	it("does not classify unknown dotless Go imports as standard-library packages", async () => {
		const root = await fixture({
			"go.mod": "module example.com/acme/app\n\ngo 1.24\n",
			"main.go": 'package main\nimport "corp/internal/log"\nfunc main() {}\n',
		});

		const snapshot = await buildProjectStructureSnapshot({ projectPath: root });

		expect(
			snapshot.references.find(
				(reference) => reference.specifier === "corp/internal/log",
			),
		).toMatchObject({
			kind: "external_package",
			status: "external",
			resolverId: "go-module-import",
		});
	});

	it("marks Go imports affected by replace directives as ambiguous", async () => {
		const root = await fixture({
			"go.mod": [
				"module example.com/acme/app",
				"go 1.24",
				"replace corp.invalid/lib => ./third_party/lib",
			].join("\n"),
			"main.go": 'package main\nimport "corp.invalid/lib/pkg"\nfunc main() {}\n',
		});

		const snapshot = await buildProjectStructureSnapshot({ projectPath: root });

		expect(
			snapshot.references.find(
				(reference) => reference.specifier === "corp.invalid/lib/pkg",
			),
		).toMatchObject({
			status: "ambiguous",
			diagnosticCodes: ["resolution_go_replace_not_applied"],
		});
	});
});

async function fixture(files: Record<string, string>): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-python-go-"));
	temporaryRoots.push(root);
	for (const [relativePath, content] of Object.entries(files)) {
		const absolutePath = path.join(root, relativePath);
		await fs.mkdir(path.dirname(absolutePath), { recursive: true });
		await fs.writeFile(absolutePath, content);
	}
	return root;
}
