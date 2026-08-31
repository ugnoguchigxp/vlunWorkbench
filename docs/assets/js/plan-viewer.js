const viewer = document.querySelector("#plan-viewer");
const frame = document.querySelector(".plan-document-frame");
const outline = document.querySelector(".plan-outline-list");
const documentLinks = Array.from(
	document.querySelectorAll(".plan-navigation-link[data-document-id]"),
);

if (!(viewer instanceof HTMLElement)) {
	throw new Error("Plan viewer root was not found");
}
if (!(frame instanceof HTMLIFrameElement)) {
	throw new Error("Plan document frame was not found");
}
if (!(outline instanceof HTMLOListElement)) {
	throw new Error("Plan outline was not found");
}

let currentLink = null;

for (const link of documentLinks) {
	link.addEventListener("click", (event) => {
		event.preventDefault();
		selectDocument(link, "push");
		closePanels();
	});
}

for (const button of document.querySelectorAll("[data-panel-toggle]")) {
	button.addEventListener("click", () => {
		const panel = button.getAttribute("data-panel-toggle");
		const nextPanel = viewer.dataset.openPanel === panel ? undefined : panel;
		setOpenPanel(nextPanel);
	});
}

for (const button of document.querySelectorAll("[data-panel-close]")) {
	button.addEventListener("click", closePanels);
}

window.addEventListener("popstate", () => {
	selectDocument(linkFromLocation() ?? documentLinks[0], "none");
});

frame.addEventListener("load", () => {
	renderOutline();
	synchronizeFromFrame();
});

selectDocument(linkFromLocation() ?? documentLinks[0], "replace");

function selectDocument(link, historyMode) {
	if (!(link instanceof HTMLAnchorElement)) return;
	const documentUrl = link.dataset.documentUrl;
	const documentId = link.dataset.documentId;
	const documentTitle = link.dataset.documentTitle;
	if (!documentUrl || !documentId || !documentTitle) return;

	currentLink = link;
	for (const candidate of documentLinks) {
		if (candidate === link) {
			candidate.setAttribute("aria-current", "page");
		} else {
			candidate.removeAttribute("aria-current");
		}
	}

	frame.title = documentTitle;
	document.title = `${documentTitle} | 実装計画アーカイブ`;
	const nextFrameUrl = new URL(documentUrl, window.location.href).href;
	if (frame.src !== nextFrameUrl) frame.src = nextFrameUrl;

	if (historyMode !== "none") {
		const nextUrl = new URL(window.location.href);
		nextUrl.searchParams.set("doc", documentId);
		const method = historyMode === "push" ? "pushState" : "replaceState";
		window.history[method]({ documentId }, "", nextUrl);
	}
}

function linkFromLocation() {
	const documentId = new URL(window.location.href).searchParams.get("doc");
	if (!documentId) return null;
	return (
		documentLinks.find((link) => link.dataset.documentId === documentId) ?? null
	);
}

function synchronizeFromFrame() {
	let pathname;
	try {
		pathname = new URL(frame.contentWindow.location.href).pathname;
	} catch {
		return;
	}
	const matchingLink = documentLinks.find((link) => {
		const documentUrl = link.dataset.documentUrl;
		return (
			documentUrl &&
			new URL(documentUrl, window.location.href).pathname === pathname
		);
	});
	if (matchingLink && matchingLink !== currentLink) {
		selectDocument(matchingLink, "replace");
	}
}

function renderOutline() {
	const frameDocument = frame.contentDocument;
	if (!frameDocument) return;
	const headings = Array.from(frameDocument.querySelectorAll("h1, h2, h3"));
	const fragment = document.createDocumentFragment();
	const usedIds = new Set();

	headings.forEach((heading, index) => {
		let id = heading.id.trim();
		if (!id || usedIds.has(id)) {
			id = `archive-outline-${index + 1}`;
			heading.id = id;
		}
		usedIds.add(id);
		const item = document.createElement("li");
		item.dataset.level = heading.tagName.slice(1);
		const link = document.createElement("a");
		link.href = `#${encodeURIComponent(id)}`;
		link.textContent =
			heading.textContent?.replace(/\s+/gu, " ").trim() || "無題の節";
		link.addEventListener("click", (event) => {
			event.preventDefault();
			heading.scrollIntoView({ block: "start" });
			frame.contentWindow.history.replaceState(
				null,
				"",
				`#${encodeURIComponent(id)}`,
			);
			closePanels();
		});
		item.append(link);
		fragment.append(item);
	});

	outline.replaceChildren(fragment);
}

function setOpenPanel(panel) {
	if (panel) {
		viewer.dataset.openPanel = panel;
	} else {
		delete viewer.dataset.openPanel;
	}
	for (const button of document.querySelectorAll("[data-panel-toggle]")) {
		button.setAttribute(
			"aria-expanded",
			String(button.getAttribute("data-panel-toggle") === panel),
		);
	}
}

function closePanels() {
	setOpenPanel(undefined);
}
