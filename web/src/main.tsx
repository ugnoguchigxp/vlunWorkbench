import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router";
import "./styles.css";
import "./styles-auth.css";
import "./styles-content.css";
import "./styles-admin.css";
import "./styles-knowledge.css";
import "./styles-scans.css";
import "./styles-projects.css";
import "./styles-project-intelligence.css";
import "./showcase.css";

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element not found");
}

createRoot(root).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
