import { createRoute } from "@tanstack/react-router";
import { parseShowcaseTableSearch } from "../showcase-table-search";
import { ShowcaseView } from "../views/showcase-view";
import { rootRoute } from "./root-route";

export const showcaseRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/showcase",
	validateSearch: parseShowcaseTableSearch,
	component: ShowcaseView,
});
