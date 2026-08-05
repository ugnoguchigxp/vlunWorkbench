import { createRoute } from "@tanstack/react-router";
import { ProtectedView } from "../views/protected-view";
import { rootRoute } from "./root-route";

export const protectedRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/protected",
	component: ProtectedView,
});
