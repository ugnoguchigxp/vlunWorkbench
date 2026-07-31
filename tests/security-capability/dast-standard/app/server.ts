export type DastStandardFixtureMode = "vulnerable" | "fixed";

export const DAST_STANDARD_OPENAPI = {
	openapi: "3.1.0",
	info: { title: "Owned DAST standard fixture", version: "1.0.0" },
	paths: {
		"/unlinked": { get: { responses: { "200": { description: "ok" } } } },
		"/api/health": {
			get: { responses: { "200": { description: "ok" } } },
		},
		"/users/{id}": {
			get: {
				parameters: [
					{
						name: "id",
						in: "path",
						required: true,
						schema: { type: "string", example: "fixture-user" },
					},
				],
				responses: { "200": { description: "ok" } },
			},
		},
		"/teams/{teamId}": {
			get: {
				parameters: [
					{
						name: "teamId",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: { "200": { description: "ok" } },
			},
		},
	},
} as const;

const secureHtmlHeaders = {
	"content-type": "text/html; charset=utf-8",
	"content-security-policy": "default-src 'self'",
	"x-frame-options": "DENY",
	"x-content-type-options": "nosniff",
	"referrer-policy": "same-origin",
};

export function startDastStandardFixture(mode: DastStandardFixtureMode) {
	const requests: Array<{ method: string; path: string }> = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			requests.push({ method: request.method, path: url.pathname });
			if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
				return new Response("method not allowed", { status: 405 });
			}
			return fixtureResponse(url.pathname, mode);
		},
	});
	return {
		origin: `http://127.0.0.1:${server.port}`,
		requests,
		async stop() {
			await server.stop(true);
		},
	};
}

function fixtureResponse(
	path: string,
	mode: DastStandardFixtureMode,
): Response {
	if (path === "/") {
		const links = [
			...Array.from(
				{ length: 10 },
				(_, index) => `/depth-1/${index + 1}`,
			),
			"/headers",
			"/cors",
			"/cookie",
			"/listing",
			"/server-error",
			"/debug",
			"/redirect",
			"/external-redirect",
			"/forms",
			"/auth",
			"/excluded/private",
			"https://example.com/public",
		];
		return html(
			links.map((href) => `<a href="${href}">${href}</a>`).join("\n"),
		);
	}
	const depthOne = path.match(/^\/depth-1\/(\d+)$/);
	if (depthOne) return html(`<a href="/depth-2/${depthOne[1]}">next</a>`);
	const depthTwo = path.match(/^\/depth-2\/(\d+)$/);
	if (depthTwo) return html(`<a href="/depth-3/${depthTwo[1]}">next</a>`);
	if (/^\/depth-3\/\d+$/.test(path)) return html("<p>depth three</p>");
	if (path === "/forms") {
		return html(
			[
				'<form method="GET" action="/search"></form>',
				'<form method="POST" action="/mutate"></form>',
			].join("\n"),
		);
	}
	if (path === "/search") return html("<p>search</p>");
	if (path === "/redirect")
		return new Response(null, { status: 302, headers: { location: "/depth-1/1" } });
	if (path === "/external-redirect")
		return new Response(null, {
			status: 302,
			headers: { location: "https://example.com/outside" },
		});
	if (path === "/auth")
		return json({ error: "authentication required" }, { status: 401 });
	if (
		path === "/unlinked" ||
		path === "/api/health" ||
		path === "/users/fixture-user"
	)
		return json({ ok: true });
	if (path === "/openapi.json")
		return json(DAST_STANDARD_OPENAPI);
	if (path === "/swagger.json")
		return json({ error: "not found" }, { status: 404 });

	if (path === "/.env") {
		return mode === "vulnerable"
			? new Response(
					"DATABASE_URL=sqlite://fixture\nDAST_CANARY_SECRET=phase51-owned-fixture",
					{ headers: { "content-type": "text/plain" } },
				)
			: html("<main id=\"app\">single page application</main>");
	}
	if (path === "/debug") {
		return mode === "vulnerable"
			? new Response("Debug mode enabled\nTypeError at fixture.ts:10:2", {
					headers: { "content-type": "text/plain" },
				})
			: new Response("debug route disabled", {
					status: 404,
					headers: { "content-type": "text/plain" },
				});
	}
	if (path === "/headers") {
		return mode === "vulnerable"
			? new Response("<html><body>header fixture</body></html>", {
					headers: { "content-type": "text/html" },
				})
			: html("<p>header fixture</p>");
	}
	if (path === "/cors") {
		return json(
			{ classification: "public fixture" },
			{
				headers: {
					"access-control-allow-origin":
						mode === "vulnerable" ? "*" : "https://app.example.test",
				},
			},
		);
	}
	if (path === "/cookie") {
		return new Response("cookie fixture", {
			headers: {
				"content-type": "text/plain",
				"set-cookie":
					mode === "vulnerable"
						? "session=fixture; Path=/"
						: "session=fixture; Path=/; HttpOnly; SameSite=Lax",
			},
		});
	}
	if (path === "/listing") {
		return mode === "vulnerable"
			? html("<html><title>Index of /uploads</title></html>")
			: html("<p>listing disabled</p>");
	}
	if (path === "/server-error") {
		return mode === "vulnerable"
			? new Response("internal error", {
					status: 500,
					headers: { "content-type": "text/plain" },
				})
			: new Response("recovered", {
					status: 200,
					headers: { "content-type": "text/plain" },
				});
	}
	return json({ error: "not found" }, { status: 404 });
}

function html(body: string): Response {
	return new Response(`<!doctype html><html><body>${body}</body></html>`, {
		headers: secureHtmlHeaders,
	});
}

function json(
	body: unknown,
	init: {
		status?: number;
		headers?: Record<string, string>;
	} = {},
): Response {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { "content-type": "application/json", ...init.headers },
	});
}
