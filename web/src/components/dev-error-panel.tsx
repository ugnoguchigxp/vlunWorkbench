import type { ErrorComponentProps } from "@tanstack/react-router";
import { AlertTriangle, Clipboard, FileStack, RefreshCcw } from "lucide-react";
import { useMemo, useState } from "react";

type ErrorDetails = {
	name: string;
	message: string;
	stack: string;
	componentStack: string;
	location: string;
	pathname: string;
	timestamp: string;
};

type DiagnosticContext = {
	appFrames: string[];
	topFrames: string[];
	componentFrames: string[];
	routeHints: string[];
	aiContext: string;
	fullDetails: string;
};

function getErrorDetails(
	error: unknown,
	componentStack?: string,
): ErrorDetails {
	const location =
		typeof window === "undefined" ? "unknown" : window.location.href;
	const pathname =
		typeof window === "undefined" ? "unknown" : window.location.pathname;
	const timestamp = new Date().toISOString();

	if (error instanceof Error) {
		return {
			name: error.name || "Error",
			message: error.message || "Unknown error",
			stack: error.stack || `${error.name}: ${error.message}`,
			componentStack: componentStack?.trim() ?? "",
			location,
			pathname,
			timestamp,
		};
	}

	return {
		name: "Thrown value",
		message:
			typeof error === "string" ? error : "A non-Error value was thrown.",
		stack:
			typeof error === "string"
				? error
				: JSON.stringify(error, null, 2) || String(error),
		componentStack: componentStack?.trim() ?? "",
		location,
		pathname,
		timestamp,
	};
}

function normalizeFrame(frame: string): string {
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	return frame
		.trim()
		.replace(origin, "")
		.replace(/^at\s+/, "")
		.replace(/\?.*?:/, ":");
}

function extractAppFrames(stack: string): string[] {
	const appFrameMarkers = ["/web/src/", "/api/", "/shared/"];
	return stack
		.split("\n")
		.map(normalizeFrame)
		.filter((line) => appFrameMarkers.some((marker) => line.includes(marker)))
		.filter((line, index, lines) => lines.indexOf(line) === index)
		.slice(0, 5);
}

function extractTopFrames(stack: string, appFrames: string[]): string[] {
	if (appFrames.length > 0) return appFrames.slice(0, 3);

	return stack
		.split("\n")
		.slice(1)
		.map(normalizeFrame)
		.filter(Boolean)
		.filter((line, index, lines) => lines.indexOf(line) === index)
		.slice(0, 3);
}

function extractComponentFrames(componentStack: string): string[] {
	return componentStack
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, 6);
}

function inferRouteHints(pathname: string): string[] {
	if (pathname === "/") {
		return [
			"web/src/routes/root-route.tsx",
			"web/src/routes/home-route.tsx",
			"web/src/views/home-view.tsx",
		];
	}
	if (pathname.startsWith("/showcase")) {
		return [
			"web/src/routes/root-route.tsx",
			"web/src/routes/showcase-route.tsx",
			"web/src/views/showcase-view.tsx",
		];
	}
	if (pathname.startsWith("/login")) {
		return [
			"web/src/routes/root-route.tsx",
			"web/src/routes/login-route.tsx",
			"web/src/views/login-view.tsx",
		];
	}
	return ["web/src/routes/root-route.tsx"];
}

function formatFullDetails(details: ErrorDetails): string {
	return [
		`${details.name}: ${details.message}`,
		`URL: ${details.location}`,
		`Time: ${details.timestamp}`,
		"",
		"Stack trace:",
		details.stack,
		details.componentStack ? "\nReact component stack:" : "",
		details.componentStack,
	]
		.filter(Boolean)
		.join("\n");
}

function formatAiContext(
	details: ErrorDetails,
	appFrames: string[],
	topFrames: string[],
	componentFrames: string[],
	routeHints: string[],
): string {
	return [
		"## Error",
		`${details.name}: ${details.message}`,
		"",
		"## Runtime",
		`Route: ${details.pathname}`,
		`URL: ${details.location}`,
		`Mode: ${import.meta.env.MODE}`,
		"",
		"## Suspect app frames",
		...(appFrames.length ? appFrames.map((frame) => `- ${frame}`) : ["- none"]),
		"",
		"## Top stack frames",
		...(topFrames.length ? topFrames.map((frame) => `- ${frame}`) : ["- none"]),
		"",
		"## Route file hints",
		...routeHints.map((hint) => `- ${hint}`),
		"",
		"## React component stack",
		...(componentFrames.length
			? componentFrames.map((frame) => `- ${frame}`)
			: ["- none"]),
		"",
		"## Request",
		"Find the likely cause and propose the smallest fix. Full stack trace is omitted to save context unless needed.",
	].join("\n");
}

function buildDiagnosticContext(details: ErrorDetails): DiagnosticContext {
	const appFrames = extractAppFrames(details.stack);
	const topFrames = extractTopFrames(details.stack, appFrames);
	const componentFrames = extractComponentFrames(details.componentStack);
	const routeHints = inferRouteHints(details.pathname);
	return {
		appFrames,
		topFrames,
		componentFrames,
		routeHints,
		aiContext: formatAiContext(
			details,
			appFrames,
			topFrames,
			componentFrames,
			routeHints,
		),
		fullDetails: formatFullDetails(details),
	};
}

async function copyText(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}

	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "");
	textarea.style.position = "fixed";
	textarea.style.left = "-9999px";
	document.body.appendChild(textarea);
	textarea.select();
	document.execCommand("copy");
	document.body.removeChild(textarea);
}

export function DevErrorPanel({ error, info, reset }: ErrorComponentProps) {
	const [copyStatus, setCopyStatus] = useState<
		"idle" | "ai-copied" | "full-copied" | "failed"
	>("idle");
	const details = useMemo(
		() => getErrorDetails(error, info?.componentStack),
		[error, info?.componentStack],
	);
	const diagnosticContext = useMemo(
		() => buildDiagnosticContext(details),
		[details],
	);

	async function handleCopy(text: string, status: "ai-copied" | "full-copied") {
		try {
			await copyText(text);
			setCopyStatus(status);
			window.setTimeout(() => setCopyStatus("idle"), 1600);
		} catch {
			setCopyStatus("failed");
		}
	}

	return (
		<main className="dev-error-shell">
			<section className="dev-error-panel" aria-labelledby="dev-error-title">
				<div className="dev-error-header">
					<div className="dev-error-title-row">
						<span className="dev-error-icon">
							<AlertTriangle className="icon" />
						</span>
						<div>
							<p className="dev-error-kicker">Application error</p>
							<h1 id="dev-error-title">{details.message}</h1>
						</div>
					</div>
					<div className="dev-error-actions">
						<button
							type="button"
							className="dev-error-action"
							aria-label="Copy AI context"
							title="Copy AI context"
							onClick={() =>
								void handleCopy(diagnosticContext.aiContext, "ai-copied")
							}
						>
							<Clipboard className="icon" />
							{copyStatus === "ai-copied"
								? "AI context copied"
								: copyStatus === "failed"
									? "Copy failed"
									: "Copy AI context"}
						</button>
						<button
							type="button"
							className="dev-error-action"
							aria-label="Copy full error details"
							title="Copy full error details"
							onClick={() =>
								void handleCopy(diagnosticContext.fullDetails, "full-copied")
							}
						>
							<FileStack className="icon" />
							{copyStatus === "full-copied" ? "Full stack copied" : "Copy full"}
						</button>
						<button
							type="button"
							className="dev-error-action"
							aria-label="Retry render"
							title="Retry render"
							onClick={reset}
						>
							<RefreshCcw className="icon" />
							Retry
						</button>
					</div>
				</div>

				<div className="dev-error-meta">
					<div>
						<span>Name</span>
						<strong>{details.name}</strong>
					</div>
					<div>
						<span>URL</span>
						<strong>{details.location}</strong>
					</div>
					<div>
						<span>Time</span>
						<strong>{details.timestamp}</strong>
					</div>
				</div>

				<div className="dev-error-section">
					<div className="dev-error-section-header">
						<h2>AI context preview</h2>
					</div>
					<pre>{diagnosticContext.aiContext}</pre>
				</div>

				<div className="dev-error-section">
					<div className="dev-error-section-header">
						<h2>
							{diagnosticContext.appFrames.length
								? "Suspect app frames"
								: "Top stack frames"}
						</h2>
					</div>
					<ul className="dev-error-list">
						{(diagnosticContext.appFrames.length
							? diagnosticContext.appFrames
							: diagnosticContext.topFrames
						).map((frame) => (
							<li key={frame}>{frame}</li>
						))}
					</ul>
				</div>

				<div className="dev-error-section">
					<div className="dev-error-section-header">
						<h2>Route file hints</h2>
					</div>
					<ul className="dev-error-list">
						{diagnosticContext.routeHints.map((frame) => (
							<li key={frame}>{frame}</li>
						))}
					</ul>
				</div>

				<div className="dev-error-section">
					<details>
						<summary>Full stack trace</summary>
						<pre>{details.stack}</pre>
					</details>
				</div>

				{details.componentStack ? (
					<div className="dev-error-section">
						<details>
							<summary>Full React component stack</summary>
							<pre>{details.componentStack}</pre>
						</details>
					</div>
				) : null}
			</section>
		</main>
	);
}
