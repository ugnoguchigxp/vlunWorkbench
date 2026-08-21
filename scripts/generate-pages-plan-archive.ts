import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";

const projectRoot = path.resolve(import.meta.dir, "..");
const archiveRoot = path.join(projectRoot, "spec", "docs", ".archived");
const specRoot = path.join(projectRoot, "spec");
const specAssetsRoot = path.join(specRoot, "assets");

type ArchiveSource = {
	sourcePath: string;
	relativePath: string;
	slug: string;
	format: "html" | "markdown";
};

type ArchiveDocument = ArchiveSource & {
	title: string;
	fragment: string;
	url: string;
};

const args = parseArgs(process.argv.slice(2));
const destination = resolveDestination(args.destination);
const baseurl = normalizeBaseurl(args.baseurl);
const homeUrl = withBaseurl(baseurl, "/");
const archiveUrl = withBaseurl(baseurl, "/plans/archive/");
const plansAssetsUrl = withBaseurl(baseurl, "/plans/assets/");
const documentStylesheetUrl = withBaseurl(
	baseurl,
	"/assets/css/spec-document.css",
);
const documentExtensionStylesheetUrl = withBaseurl(
	baseurl,
	"/assets/css/plan-document.css",
);
const viewerStylesheetUrl = withBaseurl(baseurl, "/assets/css/plan-viewer.css");
const viewerScriptUrl = withBaseurl(baseurl, "/assets/js/plan-viewer.js");

const repositoryUrl = await readRepositoryUrl();
const sources = await discoverSources();
const sourceByPath = new Map(
	sources.map((source) => [path.resolve(source.sourcePath), source]),
);
const documents = (
	await Promise.all(
		sources.map((source) => buildDocument(source, sourceByPath)),
	)
).sort((left, right) =>
	left.title.localeCompare(right.title, "ja", { sensitivity: "base" }),
);

if (documents.length === 0) {
	throw new Error(`Archived documents were not found under ${archiveRoot}`);
}

await generateArchive(documents);
console.log(
	`Generated ${documents.length} archived documents in ${path.relative(projectRoot, destination)}`,
);

async function discoverSources(): Promise<ArchiveSource[]> {
	const entries = await readdir(archiveRoot, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.flatMap((entry): ArchiveSource[] => {
			const extension = path.extname(entry.name).toLowerCase();
			if (
				extension !== ".html" &&
				extension !== ".md" &&
				extension !== ".markdown"
			) {
				return [];
			}
			const relativePath = entry.name;
			return [
				{
					sourcePath: path.join(archiveRoot, entry.name),
					relativePath,
					slug: safeSlug(path.basename(entry.name, extension)),
					format: extension === ".html" ? "html" : "markdown",
				},
			];
		});
}

async function buildDocument(
	source: ArchiveSource,
	sourceByPath: ReadonlyMap<string, ArchiveSource>,
): Promise<ArchiveDocument> {
	const rawFragment =
		source.format === "html"
			? await readFile(source.sourcePath, "utf8")
			: await convertMarkdown(source.sourcePath);
	const $ = load(rawFragment, undefined, false);
	const article = $("article").first();
	if (article.length !== 1) {
		throw new Error(`${source.relativePath} must contain one root article`);
	}

	article.find("script").remove();
	article.find("canvas").each((_index, element) => {
		$(element).replaceWith(
			'<aside data-type="warning"><strong>Chart omitted</strong><p>この静的アーカイブではChart.jsを実行しません。</p></aside>',
		);
	});
	ensureHeadingIds($, article);
	rewriteReferences($, article, source, sourceByPath);

	const title = article.find("h1").first().text().replace(/\s+/gu, " ").trim();
	if (title.length === 0) {
		throw new Error(`${source.relativePath} does not have a non-empty h1`);
	}

	return {
		...source,
		title,
		fragment: $.html(article),
		url: `${archiveUrl}${encodeURIComponent(source.slug)}/`,
	};
}

async function convertMarkdown(sourcePath: string): Promise<string> {
	const cliPath = path.join(
		projectRoot,
		"node_modules",
		"spec-html",
		"dist",
		"cli.js",
	);
	const processHandle = Bun.spawn(
		[process.execPath, cliPath, "convert", sourcePath, "--lang", "ja"],
		{
			cwd: projectRoot,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
		processHandle.exited,
	]);
	if (exitCode !== 0) {
		if (
			!stdout.trimStart().startsWith("<article") ||
			!stdout.trimEnd().endsWith("</article>")
		) {
			throw new Error(
				`spec-html convert failed for ${path.relative(projectRoot, sourcePath)}\n${stderr}`,
			);
		}
		console.warn(
			`Publishing ${path.relative(projectRoot, sourcePath)} with historical spec-html diagnostics:\n${stderr.trim()}`,
		);
	}
	return stdout;
}

function ensureHeadingIds(
	$: ReturnType<typeof load>,
	article: ReturnType<ReturnType<typeof load>>,
): void {
	const used = new Set<string>();
	let generated = 1;
	article.find("h1, h2, h3").each((_index, element) => {
		const heading = $(element);
		let id = heading.attr("id")?.trim() ?? "";
		if (id.length === 0 || used.has(id)) {
			do {
				id = `archive-section-${generated}`;
				generated += 1;
			} while (used.has(id));
			heading.attr("id", id);
		}
		used.add(id);
	});
}

function rewriteReferences(
	$: ReturnType<typeof load>,
	article: ReturnType<ReturnType<typeof load>>,
	source: ArchiveSource,
	sourceByPath: ReadonlyMap<string, ArchiveSource>,
): void {
	article.find("a[href]").each((_index, element) => {
		const anchor = $(element);
		const href = anchor.attr("href");
		if (href === undefined || referenceIsExternal(href)) return;
		const rewritten = rewriteLocalReference(href, source, sourceByPath, true);
		if (rewritten !== null) anchor.attr("href", rewritten);
	});

	article.find("img[src]").each((_index, element) => {
		const image = $(element);
		const src = image.attr("src");
		if (src === undefined || referenceIsExternal(src)) return;
		const rewritten = rewriteLocalReference(src, source, sourceByPath, false);
		if (rewritten !== null) image.attr("src", rewritten);
	});
}

function rewriteLocalReference(
	reference: string,
	source: ArchiveSource,
	sourceByPath: ReadonlyMap<string, ArchiveSource>,
	allowRepositoryFallback: boolean,
): string | null {
	if (reference.startsWith("#") || reference.startsWith("/")) return null;
	const match = reference.match(/^([^?#]*)([?#].*)?$/u);
	if (match === null || match[1].length === 0) return null;
	const referencePath = decodeURIComponent(match[1]);
	const suffix = match[2] ?? "";
	const resolved = path.resolve(path.dirname(source.sourcePath), referencePath);
	const target = sourceByPath.get(resolved);
	if (target !== undefined) {
		return `${archiveUrl}?doc=${encodeURIComponent(target.slug)}${suffix}`;
	}
	if (isPathWithin(specAssetsRoot, resolved)) {
		return `${plansAssetsUrl}${encodePath(path.relative(specAssetsRoot, resolved))}${suffix}`;
	}
	if (allowRepositoryFallback && isPathWithin(projectRoot, resolved)) {
		return `${repositoryUrl}/blob/main/${encodePath(path.relative(projectRoot, resolved))}${suffix}`;
	}
	return null;
}

async function generateArchive(
	documents: readonly ArchiveDocument[],
): Promise<void> {
	const archiveDestination = path.join(destination, "plans", "archive");
	const plansAssetsDestination = path.join(destination, "plans", "assets");
	await rm(archiveDestination, { recursive: true, force: true });
	await rm(plansAssetsDestination, { recursive: true, force: true });
	await mkdir(archiveDestination, { recursive: true });
	await mkdir(path.join(destination, "assets", "css"), { recursive: true });
	await mkdir(path.join(destination, "assets", "vendor", "spec-html"), {
		recursive: true,
	});

	await cp(specAssetsRoot, plansAssetsDestination, { recursive: true });
	await cp(
		path.join(
			projectRoot,
			"node_modules",
			"spec-html",
			"dist",
			"browser",
			"document.css",
		),
		path.join(destination, "assets", "css", "spec-document.css"),
	);
	await cp(
		path.join(projectRoot, "node_modules", "spec-html", "LICENSE"),
		path.join(destination, "assets", "vendor", "spec-html", "LICENSE.txt"),
	);

	for (const document of documents) {
		const documentDestination = path.join(archiveDestination, document.slug);
		await mkdir(documentDestination, { recursive: true });
		await writeFile(
			path.join(documentDestination, "index.html"),
			renderDocumentPage(document),
			"utf8",
		);
	}

	await writeFile(
		path.join(archiveDestination, "index.html"),
		renderViewerPage(documents),
		"utf8",
	);
	await writeFile(
		path.join(archiveDestination, "manifest.json"),
		`${JSON.stringify(
			documents.map(({ title, slug, relativePath, format, url }) => ({
				title,
				slug,
				relativePath,
				format,
				url,
			})),
			null,
			2,
		)}\n`,
		"utf8",
	);
}

function renderViewerPage(documents: readonly ArchiveDocument[]): string {
	const firstDocument = documents[0];
	const navigation = documents
		.map(
			(document, index) => `
          <a
            class="plan-navigation-link"
            href="${archiveUrl}?doc=${encodeURIComponent(document.slug)}"
            data-document-id="${escapeHtml(document.slug)}"
            data-document-url="${escapeHtml(document.url)}"
            data-document-title="${escapeHtml(document.title)}"${index === 0 ? '\n            aria-current="page"' : ""}
          >
            <span>${escapeHtml(document.title)}</span>
            <small>${document.format === "markdown" ? "MD" : "HTML"}</small>
          </a>`,
		)
		.join("");

	return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,follow">
    <title>実装計画アーカイブ | vulnWorkbench</title>
    <link rel="stylesheet" href="${viewerStylesheetUrl}">
  </head>
  <body>
    <div class="plan-viewer" id="plan-viewer">
      <header class="plan-mobile-header">
        <button type="button" data-panel-toggle="documents" aria-expanded="false">文書一覧</button>
        <a href="${homeUrl}">LPへ戻る</a>
        <button type="button" data-panel-toggle="outline" aria-expanded="false">目次</button>
      </header>
      <aside class="plan-sidebar" id="plan-sidebar">
        <div class="plan-sidebar-header">
          <a class="plan-home-link" href="${homeUrl}">← vulnWorkbenchのLPへ戻る</a>
          <h1>実装計画アーカイブ</h1>
          <p>${documents.length}件の履歴文書</p>
        </div>
        <nav class="plan-navigation" aria-label="アーカイブ文書一覧">${navigation}
        </nav>
        <footer class="plan-sidebar-footer">
          <a href="${withBaseurl(baseurl, "/assets/vendor/spec-html/LICENSE.txt")}">Spec HTML styles · MIT License</a>
        </footer>
      </aside>
      <main class="plan-document-region">
        <iframe
          class="plan-document-frame"
          title="${escapeHtml(firstDocument.title)}"
          src="${escapeHtml(firstDocument.url)}"
          sandbox="allow-same-origin"
        ></iframe>
      </main>
      <aside class="plan-outline" id="plan-outline">
        <div class="plan-outline-header">
          <h2>この文書の目次</h2>
          <button type="button" data-panel-close aria-label="目次を閉じる">×</button>
        </div>
        <ol class="plan-outline-list"></ol>
      </aside>
      <button class="plan-panel-backdrop" type="button" data-panel-close aria-label="パネルを閉じる"></button>
    </div>
    <script type="module" src="${viewerScriptUrl}"></script>
  </body>
</html>
`;
}

function renderDocumentPage(document: ArchiveDocument): string {
	return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,follow">
    <title>${escapeHtml(document.title)} | vulnWorkbench</title>
    <link rel="stylesheet" href="${documentStylesheetUrl}">
    <link rel="stylesheet" href="${documentExtensionStylesheetUrl}">
  </head>
  <body>
    ${document.fragment}
  </body>
</html>
`;
}

async function readRepositoryUrl(): Promise<string> {
	const config = await readFile(path.join(projectRoot, "_config.yml"), "utf8");
	const match = config.match(/^repository:\s*["']?([^"'\r\n]+)["']?\s*$/mu);
	if (match === null) {
		throw new Error("_config.yml must define repository");
	}
	return `https://github.com/${match[1].trim()}`;
}

function parseArgs(values: readonly string[]): {
	destination: string;
	baseurl: string;
} {
	let destination = "";
	let baseurl = "";
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === "--destination") {
			destination = values[index + 1] ?? "";
			index += 1;
		} else if (value === "--baseurl") {
			baseurl = values[index + 1] ?? "";
			index += 1;
		} else {
			throw new Error(`Unknown argument: ${value}`);
		}
	}
	if (destination.length === 0) {
		throw new Error("--destination is required");
	}
	return { destination, baseurl };
}

function resolveDestination(value: string): string {
	const resolved = path.resolve(projectRoot, value);
	const allowed = [
		path.join(projectRoot, "docs"),
		path.join(projectRoot, ".preview"),
	];
	if (!allowed.includes(resolved)) {
		throw new Error("Destination must be docs or .preview");
	}
	return resolved;
}

function normalizeBaseurl(value: string): string {
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === "/") return "";
	return `/${trimmed.replace(/^\/+|\/+$/gu, "")}`;
}

function withBaseurl(prefix: string, pathname: string): string {
	return `${prefix}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function referenceIsExternal(reference: string): boolean {
	return /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(reference);
}

function isPathWithin(parent: string, candidate: string): boolean {
	const relative = path.relative(parent, candidate);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

function safeSlug(value: string): string {
	const slug = value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
	if (slug.length === 0 || slug === "." || slug === "..") {
		throw new Error(`Cannot derive a safe slug from ${value}`);
	}
	return slug;
}

function encodePath(value: string): string {
	return value.split(path.sep).map(encodeURIComponent).join("/");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/gu, "&amp;")
		.replace(/</gu, "&lt;")
		.replace(/>/gu, "&gt;")
		.replace(/"/gu, "&quot;")
		.replace(/'/gu, "&#39;");
}
