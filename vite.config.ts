import path from "node:path";
import devServer from "@hono/vite-dev-server";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { APP_CONFIG_DEFAULTS } from "./api/config/appDefaults";

export default defineConfig(({ mode }) => {
	// Load env file from project root (one level up from 'web' root)
	const env = loadEnv(mode, __dirname, "");
	Object.assign(process.env, env);

	return {
		root: "web",
		plugins: [
			tailwindcss(),
			react(),
			devServer({
				entry: path.resolve(__dirname, "api/app/hono.ts"),
				exclude: [/^\/(?!api(?:\/|$)).*/],
				injectClientScript: false,
			}),
		],
		resolve: {
			alias: {
				"@mermaid-js/parser": path.resolve(
					__dirname,
					"node_modules/@mermaid-js/parser/dist/mermaid-parser.esm.min.mjs",
				),
				mermaid: path.resolve(
					__dirname,
					"node_modules/mermaid/dist/mermaid.esm.min.mjs",
				),
				"@": path.resolve(__dirname, "./web/src"),
				"@web": path.resolve(__dirname, "./web/src"),
				"@api": path.resolve(__dirname, "./api"),
				"@shared": path.resolve(__dirname, "./shared"),
			},
		},
		server: {
			host: APP_CONFIG_DEFAULTS.host,
			port: APP_CONFIG_DEFAULTS.port,
		},
		build: {
			outDir: "../dist-web",
			emptyOutDir: true,
			rolldownOptions: {
				output: {
					manualChunks(id) {
						const moduleId = id.replaceAll("\\", "/");
						if (
							/node_modules\/(?:react|react-dom|scheduler)\//.test(moduleId)
						) {
							return "react-runtime";
						}
						if (moduleId.includes("/node_modules/@tanstack/react-router/")) {
							return "tanstack-router";
						}
						if (moduleId.includes("/node_modules/@tanstack/react-query/")) {
							return "tanstack-query";
						}
						if (moduleId.includes("/node_modules/@tanstack/react-table/")) {
							return "tanstack-table";
						}
					},
				},
			},
		},
	};
});
