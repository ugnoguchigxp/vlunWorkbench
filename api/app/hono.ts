import { Hono } from "hono";
import { configureHttpMiddleware } from "./hono-middleware";
import { registerApplicationRoutes } from "./hono-routes";
import { getAppRuntime } from "./hono-runtime";
import { registerScanRoutes } from "./hono-scan-routes";

export { getAppRuntime } from "./hono-runtime";

const runtime = await getAppRuntime();
const app = new Hono();
configureHttpMiddleware(app, runtime);
registerApplicationRoutes(app, runtime);
registerScanRoutes(app, runtime);

export default app;
export type AppType = typeof app;
