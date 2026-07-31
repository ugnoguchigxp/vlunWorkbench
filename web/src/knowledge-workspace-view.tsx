import {
	Edit2,
	Eye,
	FilePlus2,
	FileText,
	FolderInput,
	FolderPlus,
	GitBranch,
	Home,
	RefreshCw,
	Save,
	Search,
	Trash2,
} from "lucide-react";
import type { DragEvent, ReactNode } from "react";
import { runSourceReindex } from "./api";
import { MarkdownEditor } from "./components/markdown-editor";
import {
	applyTagsToMeta,
	formatDateTime,
	shortCommit,
} from "./knowledge-workspace-model";
import { IconButton, SelectInput, TextInput } from "./ui";
import type { useKnowledgeWorkspaceState } from "./use-knowledge-workspace-state";

type KnowledgeWorkspaceViewProps = {
	state: ReturnType<typeof useKnowledgeWorkspaceState>;
	canManage: boolean;
	explorerTree: ReactNode;
	startCreate: () => void;
	promptCreateFolder: () => Promise<void>;
	handleSearchSource: () => Promise<void>;
	handleDragOverFolder: (event: DragEvent, path: string) => void;
	handleDropOnFolder: (event: DragEvent, path: string) => Promise<void>;
	selectExistingPage: (slug: string) => void;
	handleSave: () => Promise<void>;
	handleDelete: () => Promise<void>;
};

export function KnowledgeWorkspaceView({
	state,
	canManage,
	explorerTree,
	startCreate,
	promptCreateFolder,
	handleSearchSource,
	handleDragOverFolder,
	handleDropOnFolder,
	selectExistingPage,
	handleSave,
	handleDelete,
}: KnowledgeWorkspaceViewProps) {
	const {
		loading,
		errorText,
		statusText,
		sourceHealth,
		sourceSearchQuery,
		setSourceSearchQuery,
		sourceSearchHits,
		selectedSlug,
		selectedPagePath,
		mode,
		setMode,
		dragOverFolder,
		setDragOverFolder,
		draftSlug,
		setDraftSlug,
		draftTitle,
		setDraftTitle,
		draftTags,
		setDraftTags,
		draftBody,
		setDraftBody,
		setDraftMeta,
		sourceHistory,
		diffFrom,
		setDiffFrom,
		diffTo,
		setDiffTo,
		sourceDiff,
		explorerNodes,
		busy,
		withMutating,
		refreshTree,
		setStatusText,
	} = state;
	return (
		<main className="layout columns-3 knowledge-layout">
			<section className="panel">
				<div className="panel-header">
					<h2>Explorer</h2>
					{canManage ? (
						<div className="actions">
							<IconButton
								type="button"
								title="New page"
								onClick={() => startCreate()}
								disabled={busy}
							>
								<FilePlus2 className="icon" />
							</IconButton>
							<IconButton
								type="button"
								title="New folder"
								onClick={() => void promptCreateFolder()}
								disabled={busy}
							>
								<FolderPlus className="icon" />
							</IconButton>
						</div>
					) : null}
				</div>
				<div className="search-row">
					<TextInput
						value={sourceSearchQuery}
						onChange={(event) => setSourceSearchQuery(event.target.value)}
						placeholder="Search pages"
					/>
					<IconButton
						type="button"
						title="Search pages"
						onClick={handleSearchSource}
						disabled={busy}
					>
						<Search className="icon" />
					</IconButton>
				</div>
				<button
					type="button"
					className={`drop-root ${dragOverFolder === "" ? "active" : ""}`}
					onDragOver={(event) => handleDragOverFolder(event, "")}
					onDragLeave={() => setDragOverFolder(null)}
					onDrop={(event) => void handleDropOnFolder(event, "")}
					onClick={() => selectExistingPage("")}
				>
					<FolderInput className="icon" />
					<span>Drop to root</span>
				</button>
				<div className="explorer-tree">
					{sourceSearchHits.length > 0
						? sourceSearchHits.map((item) => (
								<button
									key={`search-${item.slug}`}
									type="button"
									className={
										selectedSlug === item.slug
											? "list-item active"
											: "list-item"
									}
									onClick={() => selectExistingPage(item.slug)}
								>
									<div>{item.slug || "home"}</div>
									<small>{item.excerpt}</small>
								</button>
							))
						: explorerTree}
					{loading ? <div className="tree-info">Loading tree...</div> : null}
					{!loading &&
					sourceSearchHits.length === 0 &&
					explorerNodes.length === 0 ? (
						<div className="tree-info">No pages yet.</div>
					) : null}
				</div>
			</section>

			<section className="panel">
				<div className="panel-header">
					<h2>{mode === "edit" ? "Edit" : "View"} Page</h2>
					<div className="actions">
						{canManage ? (
							<IconButton
								type="button"
								title="Edit"
								onClick={() => setMode("edit")}
								disabled={mode === "edit"}
							>
								<Edit2 className="icon" />
							</IconButton>
						) : null}
						{canManage ? (
							<IconButton
								type="button"
								title="View"
								onClick={() => setMode("view")}
								disabled={mode === "view"}
							>
								<Eye className="icon" />
							</IconButton>
						) : null}
						{canManage ? (
							<IconButton
								type="button"
								title="Save"
								onClick={handleSave}
								disabled={busy}
							>
								<Save className="icon" />
							</IconButton>
						) : null}
						{canManage ? (
							<IconButton
								type="button"
								title="Delete selected"
								onClick={() => void handleDelete()}
								disabled={busy}
							>
								<Trash2 className="icon" />
							</IconButton>
						) : null}
						{canManage ? (
							<IconButton
								type="button"
								title="Reindex"
								onClick={() =>
									void withMutating(async () => {
										const result = await runSourceReindex();
										await refreshTree();
										setStatusText(
											`Reindex completed: imported=${result.importedFiles}, skipped=${result.skippedFiles}, removed=${result.removedSources}`,
										);
									})
								}
								disabled={busy}
							>
								<RefreshCw className="icon" />
							</IconButton>
						) : null}
					</div>
				</div>

				<div className="editor-fields">
					<label htmlFor="knowledge-slug">
						Slug
						<TextInput
							id="knowledge-slug"
							disabled={!canManage || mode !== "edit"}
							value={draftSlug}
							onChange={(event) => setDraftSlug(event.target.value)}
						/>
					</label>
					<label htmlFor="knowledge-title">
						Title
						<TextInput
							id="knowledge-title"
							disabled={!canManage || mode !== "edit"}
							value={draftTitle}
							onChange={(event) => setDraftTitle(event.target.value)}
						/>
					</label>
					<label htmlFor="knowledge-tags" className="span-2">
						Tags (comma separated)
						<TextInput
							id="knowledge-tags"
							disabled={!canManage || mode !== "edit"}
							value={draftTags}
							onChange={(event) => {
								const value = event.target.value;
								setDraftTags(value);
								setDraftMeta((prev) => applyTagsToMeta(prev, value));
							}}
							placeholder="hono, rag, postgres"
						/>
					</label>
				</div>

				{errorText ? (
					<div className="section-status error">{errorText}</div>
				) : null}
				{statusText ? <div className="section-status">{statusText}</div> : null}

				<div className="knowledge-editor">
					<MarkdownEditor
						value={draftBody}
						onChange={setDraftBody}
						editable={canManage && mode === "edit"}
						toolbarMode={mode === "edit" ? "fixed" : "hidden"}
						enableVerticalScroll
						className="wysiwyg-editor"
					/>
				</div>
			</section>

			<section className="panel">
				<div className="panel-header">
					<h2>Git / History / Diff</h2>
				</div>
				<div className="meta-list">
					<div>
						<GitBranch className="icon" />
						<span>{sourceHealth?.git?.branch ?? "-"}</span>
					</div>
					<div>
						<Home className="icon" />
						<span>{sourceHealth?.git?.commit ?? "-"}</span>
					</div>
					<div>
						<FileText className="icon" />
						<span>{selectedPagePath || "-"}</span>
					</div>
				</div>
				<div className="panel-header sub">
					<h3>History</h3>
				</div>
				<div className="list compact">
					{sourceHistory.map((item) => (
						<button
							key={item.commit}
							type="button"
							className={`list-item ${diffTo === item.commit ? "active" : ""}`}
							onClick={() => setDiffTo(item.commit)}
						>
							<div>{item.message}</div>
							<small>
								{shortCommit(item.commit)} {item.author}{" "}
								{formatDateTime(item.date)}
							</small>
						</button>
					))}
					{sourceHistory.length === 0 ? (
						<div className="tree-info">No history for selected page.</div>
					) : null}
				</div>
				<div className="history-selects">
					<label htmlFor="knowledge-diff-from">
						From
						<SelectInput
							id="knowledge-diff-from"
							className="history-select"
							value={diffFrom}
							onChange={(event) => setDiffFrom(event.target.value)}
						>
							<option value="">Select commit</option>
							{sourceHistory.map((item) => (
								<option key={`from-${item.commit}`} value={item.commit}>
									{shortCommit(item.commit)} {item.message}
								</option>
							))}
						</SelectInput>
					</label>
					<label htmlFor="knowledge-diff-to">
						To
						<SelectInput
							id="knowledge-diff-to"
							className="history-select"
							value={diffTo}
							onChange={(event) => setDiffTo(event.target.value)}
						>
							<option value="">Select commit</option>
							{sourceHistory.map((item) => (
								<option key={`to-${item.commit}`} value={item.commit}>
									{shortCommit(item.commit)} {item.message}
								</option>
							))}
						</SelectInput>
					</label>
				</div>
				<div className="diff-view grow">
					<pre>
						{sourceDiff ||
							"Select two commits from history to view diff output."}
					</pre>
				</div>
			</section>
		</main>
	);
}
