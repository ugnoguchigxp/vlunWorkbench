import { ScansWorkspacePage } from "./components/scans-workspace-page";
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
			<ScansWorkspacePage />
		</ScansProvider>
	);
};
