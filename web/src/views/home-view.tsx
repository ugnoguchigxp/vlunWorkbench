export function HomeView() {
	return (
		<main className="home-shell">
			<section className="home-panel">
				<h1>Welcome to Hono Standard</h1>
				<p>
					Hono Standard is a compact full-stack starter that pairs a Hono API
					with a React and Vite frontend on a single origin.
				</p>
				<p>
					It includes SQLite-backed authentication, httpOnly cookie sessions,
					typed routing, and a reusable component showcase without forcing login
					on public screens.
				</p>
			</section>
		</main>
	);
}
