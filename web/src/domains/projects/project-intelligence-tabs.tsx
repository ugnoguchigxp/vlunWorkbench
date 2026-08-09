import { Link } from "@tanstack/react-router";
import {
	INTELLIGENCE_TABS,
	type IntelligenceViewId,
} from "./project-intelligence-tab-model";

export function IntelligenceTabs({
	projectId,
	scanRunId,
	activeView,
	moduleId,
}: {
	projectId: string;
	scanRunId: string | null;
	activeView: IntelligenceViewId;
	moduleId: string | null;
}) {
	return (
		<nav className="intelligence-tabs" aria-label="Intelligence views">
			{INTELLIGENCE_TABS.map((tab) => (
				<Link
					key={tab.id}
					to="/projects/$projectId/intelligence"
					params={{ projectId }}
					search={{
						scanRunId: scanRunId ?? undefined,
						intelligenceView: tab.id,
						moduleId:
							tab.id === "modules" ||
							tab.id === "relationships" ||
							tab.id === "handoff"
								? (moduleId ?? undefined)
								: undefined,
					}}
					className={activeView === tab.id ? "active" : ""}
					aria-current={activeView === tab.id ? "page" : undefined}
					aria-label={`${tab.label}: ${tab.description}`}
				>
					<span aria-hidden="true">{tab.number}</span>
					<strong>{tab.label}</strong>
				</Link>
			))}
		</nav>
	);
}
