import { FindingDetailPanel } from "./components/finding-detail-panel";
import { ScansSidebar, ScansToolbar } from "./components/scans-sidebar";
import { ScansProvider } from "./scans-context";
import {
	type ScansDomainSectionProps,
	useScansController,
} from "./use-scans-controller";

export const ScansDomainSection = (props: ScansDomainSectionProps) => {
	const controller = useScansController(props);
	if (!props.active) return null;
	return (
		<ScansProvider value={controller}>
			<main className="scans-layout">
				<ScansToolbar />
				<div className="scans-workspace">
					<ScansSidebar />
					<FindingDetailPanel />
				</div>
			</main>
		</ScansProvider>
	);
};
