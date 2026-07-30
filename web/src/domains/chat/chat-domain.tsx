import { Eye, EyeOff, RefreshCw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeAgenticAnswerMarkdown } from "../../agentic-markdown";
import {
	type Artifact,
	type ChatCompletionResult,
	type ConversationItem,
	type ConversationMessage,
	deleteConversation,
	fetchConversationMessages,
	fetchConversations,
	sendChat,
} from "../../api";
import { Button, IconButton, SelectInput, TextArea } from "../../ui";
import { MarkdownEditor } from "../../components/markdown-editor";

type ChatDomainSectionProps = {
	active: boolean;
	busy: boolean;
	runWithBusy: (task: () => Promise<void>) => Promise<boolean>;
	availableCategories: string[];
	setErrorText: (value: string | null) => void;
};

const toChatMessages = (
	messages: ConversationMessage[],
	nextUserMessage: string,
): Array<{ role: "user" | "assistant"; content: string }> => [
	...messages
		.filter(
			(
				message,
			): message is ConversationMessage & {
				role: "user" | "assistant";
			} => message.role !== "system",
		)
		.map((message) => ({
			role: message.role,
			content: message.content,
		})),
	{ role: "user", content: nextUserMessage },
];

const formatDateTime = (value: string | null | undefined): string => {
	if (!value) return "-";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
};

const renderArtifactContent = (artifact: Artifact): string => {
	if (typeof artifact.content === "string") {
		return artifact.content;
	}
	return JSON.stringify(artifact.content, null, 2);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const formatArtifactCell = (value: unknown): string => {
	if (value === null || value === undefined) return "";
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return String(value);
	}
	return JSON.stringify(value);
};

type ArtifactTable = {
	columns: string[];
	rows: unknown[][];
};

const toUniqueColumnLabels = (columns: string[]): string[] => {
	const counts = new Map<string, number>();
	return columns.map((column, index) => {
		const label = column.trim() || `Column ${index + 1}`;
		const count = counts.get(label) ?? 0;
		counts.set(label, count + 1);
		return count === 0 ? label : `${label} ${count + 1}`;
	});
};

const toArtifactTable = (content: unknown): ArtifactTable | null => {
	if (Array.isArray(content)) {
		if (content.length === 0) {
			return { columns: [], rows: [] };
		}
		if (content.every(isRecord)) {
			const columnKeys = Array.from(
				new Set(content.flatMap((row) => Object.keys(row))),
			);
			const columns = toUniqueColumnLabels(columnKeys);
			return {
				columns,
				rows: content.map((row) => columnKeys.map((column) => row[column])),
			};
		}
		if (content.every(Array.isArray)) {
			const [firstRow, ...bodyRows] = content;
			return {
				columns: toUniqueColumnLabels(
					firstRow.map((value, index) =>
						String(value ?? `Column ${index + 1}`),
					),
				),
				rows: bodyRows,
			};
		}
		return {
			columns: ["Value"],
			rows: content.map((value) => [value]),
		};
	}

	if (!isRecord(content)) return null;

	const columnsValue = content.columns;
	const rowsValue = content.rows;
	if (!Array.isArray(columnsValue) || !Array.isArray(rowsValue)) return null;

	const columns = toUniqueColumnLabels(
		columnsValue.map((column, index) => {
			if (typeof column === "string") return column;
			if (isRecord(column) && typeof column.label === "string")
				return column.label;
			if (isRecord(column) && typeof column.key === "string") return column.key;
			return `Column ${index + 1}`;
		}),
	);

	const columnKeys = columnsValue.map((column, index) => {
		if (typeof column === "string") return column;
		if (isRecord(column) && typeof column.key === "string") return column.key;
		if (isRecord(column) && typeof column.label === "string")
			return column.label;
		return columns[index] ?? `Column ${index + 1}`;
	});

	return {
		columns,
		rows: rowsValue.map((row) => {
			if (Array.isArray(row)) return row;
			if (isRecord(row)) return columnKeys.map((key) => row[key]);
			return [row];
		}),
	};
};

type ChartDatum = {
	label: string;
	value: number;
};

const toChartData = (content: unknown): ChartDatum[] => {
	const data =
		isRecord(content) && Array.isArray(content.data) ? content.data : content;

	if (Array.isArray(data) && data.every(isRecord)) {
		return data
			.map((row, index): ChartDatum | null => {
				const labelEntry = Object.entries(row).find(
					([, value]) => typeof value === "string",
				);
				const valueEntry = Object.entries(row).find(
					([, value]) => typeof value === "number",
				);
				const value = valueEntry?.[1];
				if (typeof value !== "number") return null;
				return {
					label:
						typeof labelEntry?.[1] === "string"
							? labelEntry[1]
							: `Item ${index + 1}`,
					value,
				};
			})
			.filter((item): item is ChartDatum => item !== null);
	}

	if (
		isRecord(content) &&
		Array.isArray(content.labels) &&
		Array.isArray(content.values)
	) {
		const labels = content.labels;
		return content.values
			.map((value, index): ChartDatum | null => {
				if (typeof value !== "number") return null;
				return {
					label: String(labels[index] ?? `Item ${index + 1}`),
					value,
				};
			})
			.filter((item): item is ChartDatum => item !== null);
	}

	return [];
};

const getMediaUrl = (content: unknown): string | null => {
	if (!isRecord(content)) return null;
	const candidates = [
		content.url,
		content.src,
		content.imageUrl,
		content.mediaUrl,
	];
	const url = candidates.find((candidate) => typeof candidate === "string");
	return typeof url === "string" ? url : null;
};

const getCaptionUrl = (content: unknown): string | null => {
	if (!isRecord(content)) return null;
	const candidates = [
		content.captionsUrl,
		content.captionUrl,
		content.subtitlesUrl,
	];
	const url = candidates.find((candidate) => typeof candidate === "string");
	return typeof url === "string" ? url : null;
};

const getMediaKind = (
	content: unknown,
	url: string,
): "image" | "video" | "audio" | null => {
	if (isRecord(content) && typeof content.mimeType === "string") {
		if (content.mimeType.startsWith("image/")) return "image";
		if (content.mimeType.startsWith("video/")) return "video";
		if (content.mimeType.startsWith("audio/")) return "audio";
	}
	if (/\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(url)) return "image";
	if (/\.(mp4|webm|mov)(\?.*)?$/i.test(url)) return "video";
	if (/\.(mp3|wav|ogg|m4a)(\?.*)?$/i.test(url)) return "audio";
	return null;
};

const ArtifactTableView = ({ table }: { table: ArtifactTable }) => (
	<div className="artifact-table-wrapper">
		<table className="artifact-table">
			<thead>
				<tr>
					{table.columns.map((column) => (
						<th key={column}>{column}</th>
					))}
				</tr>
			</thead>
			<tbody>
				{table.rows.map((row) => (
					<tr key={row.map(formatArtifactCell).join("\u001f")}>
						{table.columns.map((column, columnIndex) => (
							<td key={column}>{formatArtifactCell(row[columnIndex])}</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	</div>
);

const ArtifactChartView = ({ data }: { data: ChartDatum[] }) => {
	const maxValue = Math.max(...data.map((item) => Math.abs(item.value)), 1);
	return (
		<div className="artifact-chart">
			{data.map((item) => (
				<div className="artifact-chart-row" key={`${item.label}-${item.value}`}>
					<span>{item.label}</span>
					<div className="artifact-chart-track">
						<div
							className="artifact-chart-bar"
							style={{
								width: `${Math.max((Math.abs(item.value) / maxValue) * 100, 2)}%`,
							}}
						/>
					</div>
					<strong>{item.value}</strong>
				</div>
			))}
		</div>
	);
};

const ArtifactPreview = ({ artifact }: { artifact: Artifact }) => {
	const textContent = renderArtifactContent(artifact);
	const mediaUrl = getMediaUrl(artifact.content);
	const mediaKind = mediaUrl ? getMediaKind(artifact.content, mediaUrl) : null;
	const captionUrl = getCaptionUrl(artifact.content);

	if (mediaUrl && mediaKind === "image") {
		return (
			<figure className="artifact-media">
				<img src={mediaUrl} alt={artifact.title ?? artifact.type} />
			</figure>
		);
	}

	if (mediaUrl && mediaKind === "video" && captionUrl) {
		return (
			<figure className="artifact-media">
				<video src={mediaUrl} controls>
					<track kind="captions" src={captionUrl} srcLang="en" />
				</video>
			</figure>
		);
	}

	if (mediaUrl && mediaKind === "audio" && captionUrl) {
		return (
			<figure className="artifact-media">
				<audio src={mediaUrl} controls>
					<track kind="captions" src={captionUrl} srcLang="en" />
				</audio>
			</figure>
		);
	}

	if (artifact.type === "markdown") {
		return (
			<div className="artifact-renderer">
				<MarkdownEditor
					value={normalizeAgenticAnswerMarkdown(textContent)}
					editable={false}
					toolbarMode="hidden"
					autoHeight={true}
					className="wysiwyg-viewer"
				/>
			</div>
		);
	}

	if (artifact.type === "table") {
		const table = toArtifactTable(artifact.content);
		if (table) {
			return <ArtifactTableView table={table} />;
		}
	}

	if (artifact.type === "chart") {
		const data = toChartData(artifact.content);
		if (data.length > 0) {
			return <ArtifactChartView data={data} />;
		}
	}

	return <pre>{textContent}</pre>;
};

export const ChatDomainSection = ({
	active,
	busy,
	runWithBusy,
	availableCategories,
	setErrorText,
}: ChatDomainSectionProps) => {
	const [conversations, setConversations] = useState<ConversationItem[]>([]);
	const [activeConversationId, setActiveConversationId] = useState<
		string | null
	>(null);
	const [chatMessages, setChatMessages] = useState<ConversationMessage[]>([]);
	const [latestChatResult, setLatestChatResult] =
		useState<ChatCompletionResult | null>(null);
	const [artifactPanelVisible, setArtifactPanelVisible] = useState(false);
	const [composerText, setComposerText] = useState("");
	const [chatCategory, setChatCategory] = useState("tech");

	const conversationArtifacts = useMemo(
		() => chatMessages.flatMap((message) => message.artifacts ?? []),
		[chatMessages],
	);

	const loadConversations = useCallback(async () => {
		const items = await fetchConversations(50);
		setConversations(items);
	}, []);

	const loadConversationDetails = useCallback(
		async (conversationId: string) => {
			const messages = await fetchConversationMessages(conversationId);
			setChatMessages(messages);
		},
		[],
	);

	useEffect(() => {
		if (availableCategories.includes(chatCategory)) return;
		if (availableCategories.includes("tech")) {
			setChatCategory("tech");
			return;
		}
		setChatCategory(availableCategories[0] ?? "tech");
	}, [availableCategories, chatCategory]);

	useEffect(() => {
		if (conversationArtifacts.length === 0) return;
		setArtifactPanelVisible(true);
	}, [conversationArtifacts.length]);

	useEffect(() => {
		void loadConversations().catch((error) => {
			setErrorText(
				error instanceof Error
					? error.message
					: "Failed to load conversations.",
			);
		});
	}, [loadConversations, setErrorText]);

	const handleSendMessage = async () => {
		const text = composerText.trim();
		if (!text) return;

		await runWithBusy(async () => {
			const result = await sendChat({
				conversationId: activeConversationId ?? undefined,
				messages: toChatMessages(chatMessages, text),
				topK: 8,
				category: chatCategory === "all" ? undefined : chatCategory,
			});
			setLatestChatResult(result);
			setComposerText("");
			setActiveConversationId(result.conversationId);
			await Promise.all([
				loadConversations(),
				loadConversationDetails(result.conversationId),
			]);
		});
	};

	const handleSelectConversation = async (conversationId: string) => {
		await runWithBusy(async () => {
			setActiveConversationId(conversationId);
			setLatestChatResult(null);
			setArtifactPanelVisible(false);
			await loadConversationDetails(conversationId);
		});
	};

	const handleDeleteConversation = async (conversationId: string) => {
		if (!confirm("Are you sure you want to delete this conversation?")) return;
		await runWithBusy(async () => {
			await deleteConversation(conversationId);
			if (activeConversationId === conversationId) {
				setActiveConversationId(null);
				setChatMessages([]);
				setLatestChatResult(null);
				setArtifactPanelVisible(false);
			}
			await loadConversations();
		});
	};

	if (!active) return null;

	const hasArtifacts = conversationArtifacts.length > 0;

	return (
		<main
			className={artifactPanelVisible ? "layout columns-3" : "layout columns-2"}
		>
			<section className="panel">
				<div className="panel-header">
					<h2>Conversations</h2>
					<div className="actions">
						<IconButton
							type="button"
							title="Refresh conversations"
							onClick={() => void runWithBusy(loadConversations)}
							disabled={busy}
						>
							<RefreshCw className="icon" />
						</IconButton>
					</div>
				</div>
				<div className="list">
					{conversations.map((conversation) => (
						<div
							key={conversation.id}
							className={
								activeConversationId === conversation.id
									? "conversation-item-group active"
									: "conversation-item-group"
							}
						>
							<button
								type="button"
								className="conversation-select-btn"
								onClick={() => void handleSelectConversation(conversation.id)}
							>
								<div className="conversation-title">
									{conversation.title ?? "Conversation"}
								</div>
								<small className="conversation-date">
									{formatDateTime(conversation.updatedAt)}
								</small>
							</button>
							<IconButton
								type="button"
								className="conversation-delete-btn"
								title="Delete conversation"
								onClick={(event) => {
									event.stopPropagation();
									void handleDeleteConversation(conversation.id);
								}}
								disabled={busy}
							>
								<Trash2 className="icon" />
							</IconButton>
						</div>
					))}
				</div>
			</section>

			<section className="panel">
				<div className="panel-header">
					<h2>Messages</h2>
					<div className="actions">
						<IconButton
							type="button"
							title={artifactPanelVisible ? "Hide artifacts" : "Show artifacts"}
							aria-label={
								artifactPanelVisible ? "Hide artifacts" : "Show artifacts"
							}
							aria-pressed={artifactPanelVisible}
							onClick={() => setArtifactPanelVisible((visible) => !visible)}
						>
							{artifactPanelVisible ? (
								<EyeOff className="icon" />
							) : (
								<Eye className="icon" />
							)}
						</IconButton>
					</div>
				</div>
				<div className="chat-log">
					{chatMessages.map((message) => (
						<article
							key={message.id}
							className={`message message-${message.role}`}
						>
							<header>{message.role}</header>
							{message.role === "assistant" ? (
								<div className="chat-markdown-viewer">
									<MarkdownEditor
										value={normalizeAgenticAnswerMarkdown(message.content)}
										editable={false}
										toolbarMode="hidden"
										autoHeight={true}
										className="wysiwyg-viewer"
									/>
								</div>
							) : (
								<p>{message.content}</p>
							)}
						</article>
					))}
				</div>
				<div className="composer">
					<div className="composer-controls">
						<label htmlFor="chat-category">Category</label>
						<SelectInput
							id="chat-category"
							value={chatCategory}
							onChange={(event) => setChatCategory(event.target.value)}
						>
							<option value="all">All categories</option>
							{availableCategories.map((category) => (
								<option key={category} value={category}>
									{category}
								</option>
							))}
						</SelectInput>
					</div>
					<TextArea
						value={composerText}
						onChange={(event) => setComposerText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && event.ctrlKey) {
								event.preventDefault();
								void handleSendMessage();
							}
						}}
						placeholder="Ask with markdown context..."
					/>
					<Button
						type="button"
						variant="primary"
						onClick={() => void handleSendMessage()}
						disabled={busy}
					>
						<Send className="icon" />
						<span>Send</span>
					</Button>
				</div>
			</section>

			{artifactPanelVisible ? (
				<section className="panel">
					<div className="panel-header">
						<h2>Artifacts</h2>
					</div>
					<div className="list">
						{conversationArtifacts.map((artifact) => (
							<article key={artifact.id} className="artifact-row">
								<header>
									<div>
										<strong>{artifact.title ?? artifact.type}</strong>
										<small>{artifact.type}</small>
									</div>
									<small>v{artifact.version}</small>
								</header>
								<ArtifactPreview artifact={artifact} />
							</article>
						))}
						{!hasArtifacts && latestChatResult ? (
							latestChatResult.citations.length > 0 ? (
								<article className="artifact-row">
									<header>
										<strong>Citations</strong>
									</header>
									<ul className="citation-list">
										{latestChatResult.citations.map((citation) => (
											<li key={citation.fragmentId}>
												{citation.title} ({citation.locator})
											</li>
										))}
									</ul>
								</article>
							) : null
						) : null}
						{!hasArtifacts && !latestChatResult ? (
							<p className="artifact-empty">
								No artifacts for this conversation yet.
							</p>
						) : null}
					</div>
				</section>
			) : null}
		</main>
	);
};
