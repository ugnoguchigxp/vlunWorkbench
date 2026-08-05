import { Link } from "@tanstack/react-router";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth-context";
import { useProtectedProfileQuery } from "../api";

export function ProtectedView() {
	const { authUser, authLoading } = useAuth();
	const profileQuery = useProtectedProfileQuery(Boolean(authUser));

	if (authLoading) {
		return (
			<main className="center-shell">
				<div className="muted">Checking session...</div>
			</main>
		);
	}

	if (!authUser) {
		return (
			<main className="center-shell">
				<section className="signed-in-panel">
					<LockKeyhole className="icon" />
					<h1>Login required</h1>
					<p>This sample route only displays its content after sign-in.</p>
					<Link
						to="/login"
						search={{ redirect: "/protected" }}
						className="auth-open-button"
					>
						Login
					</Link>
				</section>
			</main>
		);
	}

	return (
		<main className="center-shell">
			<section className="signed-in-panel">
				<ShieldCheck className="icon" />
				<h1>Protected route</h1>
				<p>
					{authUser.displayName} ({authUser.role})
				</p>
				<p>
					{profileQuery.error
						? "Server profile request failed."
						: profileQuery.data
							? `Server confirmed ${profileQuery.data.email} as ${profileQuery.data.role}.`
							: "Server profile is loading."}
				</p>
			</section>
		</main>
	);
}
