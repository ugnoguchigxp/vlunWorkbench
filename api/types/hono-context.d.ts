import "hono";

declare module "hono" {
	interface ContextVariableMap {
		authUser?: {
			userId: string;
			email: string;
			role: "admin" | "member";
		};
	}
}
