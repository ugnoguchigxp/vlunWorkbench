import type { DastAuthSecretPayload } from "../../../shared/schemas/dast-auth.schema";

export function assertAuthSecretTargetsOrigin(
	secret: DastAuthSecretPayload,
	normalizedOrigin: string,
): void {
	const target = new URL(normalizedOrigin);
	if (secret.kind === "cookie_set") {
		for (const cookie of secret.cookies) {
			if (
				cookie.domain &&
				normalizeCookieDomain(cookie.domain) !== target.hostname.toLowerCase()
			) {
				throw new Error("dast_auth_cookie_domain_out_of_scope");
			}
		}
		return;
	}
	if (secret.kind !== "playwright_storage_state") return;
	for (const cookie of secret.storageState.cookies) {
		if (
			normalizeCookieDomain(cookie.domain) !== target.hostname.toLowerCase()
		) {
			throw new Error("dast_auth_cookie_domain_out_of_scope");
		}
	}
	for (const origin of secret.storageState.origins) {
		if (new URL(origin.origin).origin !== target.origin) {
			throw new Error("dast_auth_storage_origin_out_of_scope");
		}
	}
}

function normalizeCookieDomain(domain: string): string {
	return domain.replace(/^\./, "").toLowerCase();
}
