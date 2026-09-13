/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { KnowledgeWorkspace } from "./knowledge-workspace";

vi.mock("./api", async () => {
	const actual = await vi.importActual<typeof import("./api")>("./api");
	return {
		...actual,
		fetchSourceTree: vi.fn(),
		fetchSourceHealth: vi.fn(),
		fetchSourceHistory: vi.fn(),
		fetchSourceDiff: vi.fn(),
		fetchSourcePage: vi.fn(),
		createSourcePage: vi.fn(),
		createSourceFolder: vi.fn(),
		updateSourcePage: vi.fn(),
		deleteSourcePage: vi.fn(),
		deleteSourceFolder: vi.fn(),
		renameSourceFolder: vi.fn(),
		searchSourcePages: vi.fn(),
		runSourceReindex: vi.fn(),
	};
});

const tree = {
	items: [
		{
			slug: "tech",
			title: "Home",
			path: "tech/index.md",
			updatedAt: "2026-09-13T00:00:00.000Z",
		},
		{
			slug: "guide/setup",
			title: "Setup",
			path: "guide/setup.md",
			updatedAt: "2026-09-13T00:00:00.000Z",
		},
	],
	folders: [{ path: "guide" }, { path: "tech" }],
};

beforeEach(() => {
	vi.mocked(api.fetchSourceTree).mockResolvedValue(tree);
	vi.mocked(api.fetchSourceHealth).mockResolvedValue({
		service: "vuln-workbench-knowledge",
		git: { branch: "main", commit: "abc1234" },
	});
	vi.mocked(api.fetchSourceHistory).mockResolvedValue([]);
	vi.mocked(api.fetchSourcePage).mockResolvedValue({
		slug: "tech",
		title: "Home",
		body: "# Home\n",
		path: "tech/index.md",
		meta: {},
	});
	vi.mocked(api.createSourcePage).mockResolvedValue({
		ok: true,
		slug: "tech/untitled",
		commit: "c1",
	});
	vi.mocked(api.createSourceFolder).mockResolvedValue({
		ok: true,
		path: "notes",
		commit: "c2",
	});
	vi.mocked(api.searchSourcePages).mockResolvedValue([
		{ slug: "guide/setup", excerpt: "Install bun" },
	]);
	vi.mocked(api.updateSourcePage).mockResolvedValue({
		ok: true,
		slug: "guide/install",
		commit: "c3",
	});
	vi.mocked(api.deleteSourcePage).mockResolvedValue({ ok: true, commit: "c4" });
	vi.mocked(api.renameSourceFolder).mockResolvedValue({
		ok: true,
		path: "guides",
		commit: "c5",
		movedPages: [{ from: "guide/setup", to: "guides/setup" }],
	});
	window.confirm = () => true;
	window.prompt = () => "notes";
});

afterEach(() => {
	document.body.replaceChildren();
	vi.clearAllMocks();
});

async function renderWorkspace(canManage = true) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			<KnowledgeWorkspace
				canManage={canManage}
				requestedSlug="tech"
				requestedAt={1}
			/>,
		);
		await Promise.resolve();
		await Promise.resolve();
	});
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	return root;
}

describe("KnowledgeWorkspace", () => {
	it("creates, searches, and deletes pages for managers", async () => {
		const root = await renderWorkspace();
		await act(async () => {
			document
				.querySelector<HTMLButtonElement>('button[title="New page"]')
				?.click();
			await Promise.resolve();
		});
		await act(async () => {
			document
				.querySelector<HTMLButtonElement>('button[title="Save"]')
				?.click();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(api.createSourcePage).toHaveBeenCalled();
		const search = document.querySelector("input[placeholder='Search pages']");
		expect(search).toBeTruthy();
		await act(async () => {
			search?.dispatchEvent(new Event("input", { bubbles: true }));
			(search as HTMLInputElement).value = "setup";
			search?.dispatchEvent(new Event("change", { bubbles: true }));
			document
				.querySelector<HTMLButtonElement>('button[title="Search pages"]')
				?.click();
			await Promise.resolve();
			await Promise.resolve();
		});
		await act(async () => {
			document
				.querySelector<HTMLButtonElement>('button[title="New folder"]')
				?.click();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(api.createSourceFolder).toHaveBeenCalled();
		await act(async () => root.unmount());
	});
});
