// Owned, bounded models of eight business controls. Each mode processes the
// same requests; the fixed mode enforces the control at the state mutation.
export function startBusinessLogicFixture(controlId: string, fixed: boolean) {
	const initial = { effects: 0, total: 100, used: false, quota: 0 };
	let state = { ...initial };
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const pathname = new URL(request.url).pathname;
			if (pathname === "/reset" && request.method === "DELETE") {
				state = { ...initial };
				return new Response(null, { status: 204 });
			}
			if (pathname !== "/action" || request.method !== "POST")
				return new Response(null, { status: 404 });
			const body = (await request.json()) as Record<string, unknown>;
			let denied = false;
			switch (controlId) {
				case "owner-isolation":
					denied = fixed && body.actor !== "owner";
					break;
				case "role-operation-separation":
					denied = fixed && body.role !== "admin";
					break;
				case "state-transition-bypass":
					denied = fixed && body.previousState !== "paid";
					break;
				case "negative-zero-value":
					denied = fixed && Number(body.quantity) <= 0;
					break;
				case "duplicate-submission":
				case "one-time-token-reuse":
					denied = fixed && state.used;
					if (!denied) state.used = true;
					break;
				case "calculated-value-tampering":
					state.total = fixed ? 100 : Number(body.total);
					break;
				case "rate-quota-bypass":
					denied = fixed && state.quota >= 1;
					if (!denied) state.quota++;
					break;
				default:
					throw new Error(`business_fixture_unknown_control:${controlId}`);
			}
			if (!denied) state.effects++;
			return Response.json(
				{ accepted: !denied },
				{ status: denied ? 403 : 200 },
			);
		},
	});
	return {
		origin: `http://127.0.0.1:${server.port}`,
		snapshot: () => ({ ...state }),
		baseline: initial,
		stop: () => server.stop(true),
	};
}
