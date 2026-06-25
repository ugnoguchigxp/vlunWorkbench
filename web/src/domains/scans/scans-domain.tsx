import { FindingDetailPanel } from "./components/finding-detail-panel";
import { FindingsPanel } from "./components/findings-panel";
import { ScansSidebar } from "./components/scans-sidebar";
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
				<ScansSidebar />
				<FindingsPanel />
				<FindingDetailPanel />
			</main>
		</ScansProvider>
	);
};
