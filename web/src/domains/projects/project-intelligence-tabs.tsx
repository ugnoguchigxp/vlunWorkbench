import { Link } from "@tanstack/react-router";
import {
	INTELLIGENCE_TABS,
	type IntelligenceViewId,
} from "./project-intelligence-tab-model";

export function IntelligenceTabs({
	projectId,
	scanRunId,
	activeView,
}: {
	projectId: string;
	scanRunId: string | null;
	activeView: IntelligenceViewId;
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
