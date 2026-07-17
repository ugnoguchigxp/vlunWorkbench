import crypto from "node:crypto";
import type { NormalizedFinding } from "../scans/normalizers/fixture";
import {
	redactJsonSecrets,
	redactSecrets,
} from "../scans/normalizers/redaction";
import type { ZapReport, ZapSite } from "./zap-report-schema";

const riskMap: Record<string, NormalizedFinding["severity"]> = {
	"3": "high",
	"2": "medium",
	"1": "low",
	"0": "info",
};

const confidenceLabels: Record<string, string> = {
	"0": "False Positive",
	"1": "Low",
	"2": "Medium",
	"3": "High",
	"4": "Confirmed",
};

function plainText(value: string): string {
	return value
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<br\s*\/?\s*>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/\s{2,}/g, " ")
		.trim();
}

function redactUrl(
	value: string,
	origins: { upstreamOrigin: string; gatewayOrigin: string },
): string {
	let mapped = value;
	try {
		const url = new URL(value);
		if (url.origin === origins.gatewayOrigin) {
			const upstream = new URL(origins.upstreamOrigin);
			url.protocol = upstream.protocol;
			url.hostname = upstream.hostname;
			url.port = upstream.port;
		}
		url.hash = "";
		for (const [key, val] of url.searchParams.entries()) {
			if (
				/token|secret|password|passwd|api[_-]?key|auth|cookie|session|csrf/i.test(
					key,
				)
			) {
				url.searchParams.set(key, "[REDACTED]");
			} else {
				url.searchParams.set(key, redactSecrets(val));
			}
		}
		mapped = url.toString();
	} catch {
		mapped = redactSecrets(value).split("#", 1)[0];
	}
	return redactSecrets(mapped);
}

function siteOrigin(site: ZapSite): string {
	if (
		site["@name"]?.startsWith("http://") ||
		site["@name"]?.startsWith("https://")
	) {
		return site["@name"];
	}
	const host = site["@host"] ?? "unknown";
	const port = site["@port"] ? `:${site["@port"]}` : "";
	const protocol = site["@ssl"] === "true" ? "https" : "http";
	return `${protocol}://${host}${port}`;
}

export function normalizeZap(
	report: ZapReport,
	origins: { upstreamOrigin: string; gatewayOrigin: string },
): NormalizedFinding[] {
	const findings: NormalizedFinding[] = [];
	for (const site of report.site) {
		for (const alert of site.alerts ?? []) {
			const instances = alert.instances?.length
				? alert.instances
				: [{ uri: siteOrigin(site) }];
			for (const instance of instances) {
				const url = redactUrl(instance.uri, origins);
				const evidence = redactSecrets(String(instance.evidence ?? "")).slice(
					0,
					4000,
				);
				const attack = redactSecrets(String(instance.attack ?? "")).slice(
					0,
					4000,
				);
				const pluginId = alert.pluginid;
				const param = redactSecrets(String(instance.param ?? ""));
				const confidenceCode = String(alert.confidence ?? "");
				const confidenceLabel = confidenceLabels[confidenceCode] ?? "Unknown";
				const description = [
					plainText(alert.desc ?? alert.name ?? pluginId),
					alert.solution ? `Solution: ${plainText(alert.solution)}` : null,
				]
					.filter(Boolean)
					.join("\n\n");
				const evidenceHash = crypto
					.createHash("sha256")
					.update(evidence)
					.digest("hex");
				const fingerprint = `zap:${pluginId}:${url}:${param}:${evidenceHash}`;
				const compact = redactJsonSecrets({
					rule: pluginId,
					url,
					method: instance.method ?? "GET",
					parameter: param,
					evidence,
					attack,
					confidence: confidenceLabel,
					cwe: alert.cweid,
					wasc: alert.wascid,
					reference: plainText(alert.reference ?? ""),
				});
				findings.push({
					ruleId: pluginId,
					title: redactSecrets(
						plainText(alert.name ?? alert.alert ?? pluginId),
					),
					description: redactSecrets(description),
					severity: riskMap[alert.riskcode] ?? "unknown",
					confidence: "static",
					status: "open",
					primaryLocation: { path: url, startLine: 1, endLine: 1 },
					fingerprint,
					metadata: {
						zapConfidenceCode: confidenceCode || null,
						zapConfidenceLabel: confidenceLabel,
						cweId: alert.cweid ?? null,
						wascId: alert.wascid ?? null,
						method: instance.method ?? "GET",
					},
					evidences: [
						{
							kind: "tool-output",
							title: `ZAP ${pluginId}`,
							location: {
								url,
								parameter: param,
								method: instance.method ?? "GET",
							},
							snippet: JSON.stringify(compact).slice(0, 4000),
						},
					],
				});
			}
		}
	}
	return findings;
}
