import { Eye, EyeOff, RefreshCw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeAgenticAnswerMarkdown } from "../../agentic-markdown";
import {
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
import { ArtifactPreview } from "./chat-artifact-preview";

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
