import { Hono } from "hono";

export function createHealthRoute() {
	return new Hono().get("/", (c) => {
		return c.json({ status: "ok", service: "hono-standard" });
	});
}
