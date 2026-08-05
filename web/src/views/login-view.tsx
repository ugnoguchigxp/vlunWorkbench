import { Link, useSearch } from "@tanstack/react-router";
import { Shield } from "lucide-react";
import { useAuth } from "../auth-context";
import { LoginDomainSection } from "../domains/auth/login-domain";
import { defaultShowcaseTableSearch } from "../showcase-table-search";

export function LoginView() {
	const { authUser, authLoading, busy, loginWithPassword } = useAuth();
	const search = useSearch({ from: "/login" });

	if (authLoading) {
		return (
			<main className="center-shell">
				<div className="muted">Loading session...</div>
			</main>
		);
	}

	if (authUser) {
		return (
			<main className="center-shell">
				<section className="signed-in-panel">
					<Shield className="icon" />
					<h1>Signed in</h1>
					<p>
						{authUser.displayName} ({authUser.role})
					</p>
					<Link
						to="/showcase"
						search={defaultShowcaseTableSearch}
						className="auth-open-button"
					>
						Showcase
					</Link>
					<Link to="/protected" className="auth-open-button">
						Protected sample
					</Link>
				</section>
			</main>
		);
	}

	return (
		<LoginDomainSection
			active
			busy={busy}
			redirectTo={search.redirect}
			onLogin={loginWithPassword}
		/>
	);
}
