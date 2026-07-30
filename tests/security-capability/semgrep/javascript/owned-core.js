const child_process = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const serialize = require("node-serialize");

export function vulnerable(input, element) {
	// ruleid: vuln-workbench.javascript.command-injection
	child_process.exec(input);
	// ruleid: vuln-workbench.javascript.command-injection
	child_process.execSync(input);
	// ruleid: vuln-workbench.javascript.code-injection
	eval(input);
	// ruleid: vuln-workbench.javascript.code-injection
	new Function(input);
	// ruleid: vuln-workbench.javascript.dom-xss
	element.innerHTML = input;
	// ruleid: vuln-workbench.javascript.dom-xss
	document.body.innerHTML = input;
	// ruleid: vuln-workbench.javascript.ssrf-fetch
	fetch(input);
	// ruleid: vuln-workbench.javascript.ssrf-fetch
	fetch(input, { method: "GET" });
	// ruleid: vuln-workbench.javascript.path-traversal-read
	fs.readFile(input, () => {});
	// ruleid: vuln-workbench.javascript.path-traversal-read
	fs.readFileSync(input);
	// ruleid: vuln-workbench.javascript.weak-hash
	crypto.createHash("md5");
	// ruleid: vuln-workbench.javascript.weak-hash
	crypto.createHash("sha1");
	// ruleid: vuln-workbench.javascript.weak-random
	Math.random();
	// ruleid: vuln-workbench.javascript.weak-random
	return Math.random();
}

export function unsafeDecode(input) {
	// ruleid: vuln-workbench.javascript.unsafe-deserialization
	serialize.unserialize(input);
	// ruleid: vuln-workbench.javascript.unsafe-deserialization
	return serialize.unserialize(input);
}

export function fixed(element) {
	// ok: vuln-workbench.javascript.command-injection
	child_process.execFile("/usr/bin/id", ["-u"]);
	// ok: vuln-workbench.javascript.command-injection
	child_process.exec("date");
	// ok: vuln-workbench.javascript.code-injection
	JSON.parse('{"safe":true}');
	// ok: vuln-workbench.javascript.code-injection
	Object.freeze({});
	// ok: vuln-workbench.javascript.dom-xss
	element.textContent = "safe";
	// ok: vuln-workbench.javascript.dom-xss
	element.innerHTML = "<b>safe</b>";
	// ok: vuln-workbench.javascript.ssrf-fetch
	fetch("https://example.invalid/health");
	// ok: vuln-workbench.javascript.ssrf-fetch
	fetch("/api/health");
	// ok: vuln-workbench.javascript.path-traversal-read
	fs.readFile("package.json", () => {});
	// ok: vuln-workbench.javascript.path-traversal-read
	fs.readFileSync("package.json");
	// ok: vuln-workbench.javascript.weak-hash
	crypto.createHash("sha256");
	// ok: vuln-workbench.javascript.weak-hash
	crypto.createHash("sha512");
	// ok: vuln-workbench.javascript.weak-random
	crypto.randomUUID();
	// ok: vuln-workbench.javascript.weak-random
	crypto.randomBytes(32);
	// ok: vuln-workbench.javascript.unsafe-deserialization
	JSON.parse("{}");
	// ok: vuln-workbench.javascript.unsafe-deserialization
	structuredClone({});
}
