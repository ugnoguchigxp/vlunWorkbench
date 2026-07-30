import child_process from "node:child_process";
import crypto from "node:crypto";
import type { Response } from "express";
import axios from "axios";
import jwt from "jsonwebtoken";

declare const db: { query: (sql: string) => unknown };

export function vulnerable(
	input: string,
	element: HTMLElement,
	response: Response,
) {
	// ruleid: vuln-workbench.typescript.command-injection
	child_process.exec(input);
	// ruleid: vuln-workbench.typescript.command-injection
	child_process.execSync(input);
	// ruleid: vuln-workbench.typescript.sql-injection
	db.query(`SELECT * FROM users WHERE id = ${input}`);
	// ruleid: vuln-workbench.typescript.sql-injection
	db.query(`DELETE FROM users WHERE id = ${input}`);
	// ruleid: vuln-workbench.typescript.dom-xss
	element.innerHTML = input;
	// ruleid: vuln-workbench.typescript.dom-xss
	document.body.innerHTML = input;
	// ruleid: vuln-workbench.typescript.ssrf-axios
	axios.get(input);
	// ruleid: vuln-workbench.typescript.ssrf-axios
	axios.post(input);
	// ruleid: vuln-workbench.typescript.path-traversal-sendfile
	response.sendFile(input);
	// ruleid: vuln-workbench.typescript.path-traversal-sendfile
	response.sendFile(input, {});
	// ruleid: vuln-workbench.typescript.weak-hash
	crypto.createHash("md5");
	// ruleid: vuln-workbench.typescript.weak-hash
	crypto.createHash("sha1");
	// ruleid: vuln-workbench.typescript.jwt-decode-auth
	jwt.decode(input);
	// ruleid: vuln-workbench.typescript.jwt-decode-auth
	return jwt.decode(input, { json: true });
}

export function logSecrets(password: string, apiKey: string) {
	// ruleid: vuln-workbench.typescript.sensitive-console-log
	console.log(password);
	// ruleid: vuln-workbench.typescript.sensitive-console-log
	console.log("key", apiKey);
}

export function fixed(response: Response, element: HTMLElement) {
	// ok: vuln-workbench.typescript.command-injection
	child_process.execFile("/usr/bin/id", ["-u"]);
	// ok: vuln-workbench.typescript.command-injection
	child_process.exec("date");
	// ok: vuln-workbench.typescript.sql-injection
	db.query("SELECT 1");
	// ok: vuln-workbench.typescript.sql-injection
	db.query("SELECT * FROM users WHERE id = ?");
	// ok: vuln-workbench.typescript.dom-xss
	element.textContent = "safe";
	// ok: vuln-workbench.typescript.dom-xss
	element.innerHTML = "<b>safe</b>";
	// ok: vuln-workbench.typescript.ssrf-axios
	axios.get("https://example.invalid/health");
	// ok: vuln-workbench.typescript.ssrf-axios
	axios.post("/api/jobs");
	// ok: vuln-workbench.typescript.path-traversal-sendfile
	response.sendFile("index.html");
	// ok: vuln-workbench.typescript.path-traversal-sendfile
	response.sendFile("health.txt", { root: "/srv/static" });
	// ok: vuln-workbench.typescript.weak-hash
	crypto.createHash("sha256");
	// ok: vuln-workbench.typescript.weak-hash
	crypto.createHash("sha512");
	// ok: vuln-workbench.typescript.jwt-decode-auth
	jwt.verify("token", "public-key");
	// ok: vuln-workbench.typescript.jwt-decode-auth
	jwt.verify("token", "public-key", { algorithms: ["RS256"] });
	// ok: vuln-workbench.typescript.sensitive-console-log
	console.log("request complete");
	// ok: vuln-workbench.typescript.sensitive-console-log
	console.log("requestId", "opaque");
}
