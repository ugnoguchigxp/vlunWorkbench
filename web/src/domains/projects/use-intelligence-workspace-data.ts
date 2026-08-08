import { useCallback, useEffect, useRef, useState } from "react";
import type { StaticIntelligenceOntologyHandoff } from "../../../../shared/schemas/static-intelligence-module.schema";
import {
	createFindingDecision,
	type Finding,
	type FindingDecision,
	fetchFinding,
	fetchProjectOntologyHandoff,
	fetchProjectStructure,
	fetchScanFindings,
	fetchScanIntelligenceAgentQuery,
	type ProjectStructureListResponse,
} from "../../api";
import type { IntelligenceViewId } from "./project-intelligence-tab-model";

export type FindingDetail = Awaited<ReturnType<typeof fetchFinding>>;
type ResourceStatus = "idle" | "loading" | "loaded" | "failed";

type FindingsState = {
	key: string | null;
	status: ResourceStatus;
	items: Finding[];
	error: string | null;
};

type LandscapeState = {
	key: string | null;
	status: ResourceStatus;
	data: Awaited<ReturnType<typeof fetchScanIntelligenceAgentQuery>> | null;
	error: string | null;
};

type StructureState = {
	key: string | null;
	status: ResourceStatus;
	data: ProjectStructureListResponse | null;
	error: string | null;
};

type OntologyState = {
	key: string | null;
	status: ResourceStatus;
	data: StaticIntelligenceOntologyHandoff | null;
	error: string | null;
};

const errorMessage = (error: unknown, fallback: string): string =>
	error instanceof Error ? error.message : fallback;

export function useIntelligenceWorkspaceData({
	projectId,
	scanRunId,
	generationId,
	activeView,
	analysisDetailsOpen,
}: {
	projectId: string;
	scanRunId: string | null;
	generationId: string | null;
	activeView: IntelligenceViewId;
	analysisDetailsOpen: boolean;
}) {
	const findingsRequestId = useRef(0);
	const landscapeRequestId = useRef(0);
	const structureRequestId = useRef(0);
	const ontologyRequestId = useRef(0);
	const detailRequestIds = useRef(new Map<string, number>());
	const detailCache = useRef(new Map<string, FindingDetail>());
	const [, setDetailVersion] = useState(0);
	const [detailStatus, setDetailStatus] = useState<
		Record<string, ResourceStatus>
	>({});
	const [detailErrors, setDetailErrors] = useState<
		Record<string, string | null>
	>({});
	const [findingsState, setFindingsState] = useState<FindingsState>({
		key: null,
		status: "idle",
		items: [],
		error: null,
	});
	const [landscapeState, setLandscapeState] = useState<LandscapeState>({
		key: null,
		status: "idle",
		data: null,
		error: null,
	});
	const [structureState, setStructureState] = useState<StructureState>({
		key: null,
		status: "idle",
		data: null,
		error: null,
	});
	const [ontologyState, setOntologyState] = useState<OntologyState>({
		key: null,
		status: "idle",
		data: null,
		error: null,
	});

	const findingsKey = scanRunId;
	const landscapeKey =
		scanRunId && generationId ? `${scanRunId}:${generationId}` : null;
	const generationKey =
		scanRunId && generationId
			? `${projectId}:${scanRunId}:${generationId}`
			: null;
	const detailScopeKey = `${scanRunId ?? ""}:${generationId ?? ""}`;

	const loadFindings = useCallback(
		async (force = false) => {
			if (!findingsKey) return;
			if (
				!force &&
				findingsState.key === findingsKey &&
				["loading", "loaded"].includes(findingsState.status)
			)
				return;
			const requestId = ++findingsRequestId.current;
			setFindingsState((current) => ({
				key: findingsKey,
				status: "loading",
				items: current.key === findingsKey ? current.items : [],
				error: null,
			}));
			try {
				const items = await fetchScanFindings(findingsKey);
				if (requestId !== findingsRequestId.current) return;
				setFindingsState({
					key: findingsKey,
					status: "loaded",
					items,
					error: null,
				});
			} catch (error) {
				if (requestId !== findingsRequestId.current) return;
				setFindingsState((current) => ({
					key: findingsKey,
					status: "failed",
					items: current.key === findingsKey ? current.items : [],
					error: errorMessage(error, "Finding一覧を読み込めませんでした。"),
				}));
			}
		},
		[findingsKey, findingsState.key, findingsState.status],
	);

	const loadLandscape = useCallback(
		async (force = false) => {
			if (!scanRunId || !generationId || !landscapeKey) return;
			if (
				!force &&
				landscapeState.key === landscapeKey &&
				["loading", "loaded"].includes(landscapeState.status)
			)
				return;
			const requestId = ++landscapeRequestId.current;
			setLandscapeState((current) => ({
				key: landscapeKey,
				status: "loading",
				data: current.key === landscapeKey ? current.data : null,
				error: null,
			}));
			try {
				const data = await fetchScanIntelligenceAgentQuery(scanRunId, {
					mode: "overview",
					generationId,
				});
				if (requestId !== landscapeRequestId.current) return;
				setLandscapeState({
					key: landscapeKey,
					status: "loaded",
					data,
					error: null,
				});
			} catch (error) {
				if (requestId !== landscapeRequestId.current) return;
				setLandscapeState((current) => ({
					key: landscapeKey,
					status: "failed",
					data: current.key === landscapeKey ? current.data : null,
					error: errorMessage(
						error,
						"Landscapeの補足情報を読み込めませんでした。",
					),
				}));
			}
		},
		[
			generationId,
			landscapeKey,
			landscapeState.key,
			landscapeState.status,
			scanRunId,
		],
	);

	const loadStructure = useCallback(
		async (force = false) => {
			if (!scanRunId || !generationId || !generationKey) return;
			if (
				!force &&
				structureState.key === generationKey &&
				["loading", "loaded"].includes(structureState.status)
			)
				return;
			const requestId = ++structureRequestId.current;
			setStructureState((current) => ({
				key: generationKey,
				status: "loading",
				data: current.key === generationKey ? current.data : null,
				error: null,
			}));
			try {
				const data = await fetchProjectStructure(projectId, scanRunId, {
					generationId,
				});
				if (requestId !== structureRequestId.current) return;
				setStructureState({
					key: generationKey,
					status: "loaded",
					data,
					error: null,
				});
			} catch (error) {
				if (requestId !== structureRequestId.current) return;
				setStructureState((current) => ({
					key: generationKey,
					status: "failed",
					data: current.key === generationKey ? current.data : null,
					error: errorMessage(error, "構造データを読み込めませんでした。"),
				}));
			}
		},
		[
			generationId,
			generationKey,
			projectId,
			scanRunId,
			structureState.key,
			structureState.status,
		],
	);

	const loadOntology = useCallback(
		async (force = false) => {
			if (!scanRunId || !generationId || !generationKey) return;
			if (
				!force &&
				ontologyState.key === generationKey &&
				["loading", "loaded"].includes(ontologyState.status)
			)
				return;
			const requestId = ++ontologyRequestId.current;
			setOntologyState((current) => ({
				key: generationKey,
				status: "loading",
				data: current.key === generationKey ? current.data : null,
				error: null,
			}));
			try {
				const data = await fetchProjectOntologyHandoff(
					projectId,
					scanRunId,
					generationId,
				);
				if (requestId !== ontologyRequestId.current) return;
				setOntologyState({
					key: generationKey,
					status: "loaded",
					data,
					error: null,
				});
			} catch (error) {
				if (requestId !== ontologyRequestId.current) return;
				setOntologyState((current) => ({
					key: generationKey,
					status: "failed",
					data: current.key === generationKey ? current.data : null,
					error: errorMessage(
						error,
						"Ontology handoffを読み込めませんでした。",
					),
				}));
			}
		},
		[
			generationId,
			generationKey,
			ontologyState.key,
			ontologyState.status,
			projectId,
			scanRunId,
		],
	);

	const loadFindingDetail = useCallback(
		async (findingId: string, force = false) => {
			const scopedKey = `${detailScopeKey}\0${findingId}`;
			if (!scanRunId || (!force && detailCache.current.has(scopedKey))) return;
			const requestId = (detailRequestIds.current.get(scopedKey) ?? 0) + 1;
			detailRequestIds.current.set(scopedKey, requestId);
			setDetailStatus((current) => ({ ...current, [scopedKey]: "loading" }));
			setDetailErrors((current) => ({ ...current, [scopedKey]: null }));
			try {
				const detail = await fetchFinding(findingId);
				if (detailRequestIds.current.get(scopedKey) !== requestId) return;
				detailCache.current.set(scopedKey, detail);
				setDetailStatus((current) => ({ ...current, [scopedKey]: "loaded" }));
				setDetailVersion((value) => value + 1);
			} catch (error) {
				if (detailRequestIds.current.get(scopedKey) !== requestId) return;
				setDetailStatus((current) => ({ ...current, [scopedKey]: "failed" }));
				setDetailErrors((current) => ({
					...current,
					[scopedKey]: errorMessage(
						error,
						"Finding詳細を読み込めませんでした。",
					),
				}));
			}
		},
		[detailScopeKey, scanRunId],
	);

	const saveFindingDecision = useCallback(
		async (
			findingId: string,
			input: {
				decision: "false_positive" | "deferred" | "needs_fix";
				reason: FindingDecision["reason"];
				comment?: string;
				linkedReviewId?: string;
			},
		) => {
			const response = await createFindingDecision(findingId, input);
			const scopedKey = `${detailScopeKey}\0${findingId}`;
			const cached = detailCache.current.get(scopedKey);
			if (cached) {
				detailCache.current.set(scopedKey, {
					...cached,
					latestDecision: response.decision,
				});
				setDetailVersion((value) => value + 1);
			}
			setFindingsState((current) => ({
				...current,
				items: current.items.map((finding) =>
					finding.id === findingId
						? { ...finding, latestDecision: response.decision }
						: finding,
				),
			}));
			await loadFindingDetail(findingId, true);
			return response.decision;
		},
		[detailScopeKey, loadFindingDetail],
	);

	useEffect(() => {
		if (!["investigate", "guided"].includes(activeView)) return;
		void loadFindings();
	}, [activeView, loadFindings]);

	useEffect(() => {
		if (activeView !== "landscape") return;
		void loadLandscape();
	}, [activeView, loadLandscape]);

	useEffect(() => {
		if (activeView !== "landscape") return;
		void loadStructure();
	}, [activeView, loadStructure]);

	useEffect(() => {
		if (!analysisDetailsOpen) return;
		void loadOntology();
	}, [analysisDetailsOpen, loadOntology]);

	const detailPrefix = `${detailScopeKey}\0`;
	const details = Object.fromEntries(
		[...detailCache.current.entries()]
			.filter(([key]) => key.startsWith(detailPrefix))
			.map(([key, detail]) => [key.slice(detailPrefix.length), detail]),
	);
	const visibleDetailStatus = Object.fromEntries(
		Object.entries(detailStatus)
			.filter(([key]) => key.startsWith(detailPrefix))
			.map(([key, status]) => [key.slice(detailPrefix.length), status]),
	);
	const visibleDetailErrors = Object.fromEntries(
		Object.entries(detailErrors)
			.filter(([key]) => key.startsWith(detailPrefix))
			.map(([key, error]) => [key.slice(detailPrefix.length), error]),
	);

	return {
		findings:
			findingsState.key === findingsKey
				? findingsState.items
				: ([] as Finding[]),
		findingsStatus:
			findingsState.key === findingsKey ? findingsState.status : "idle",
		findingsError:
			findingsState.key === findingsKey ? findingsState.error : null,
		reloadFindings: () => loadFindings(true),
		details,
		detailStatus: visibleDetailStatus,
		detailErrors: visibleDetailErrors,
		loadFindingDetail,
		saveFindingDecision,
		landscape: landscapeState.key === landscapeKey ? landscapeState.data : null,
		landscapeStatus:
			landscapeState.key === landscapeKey ? landscapeState.status : "idle",
		landscapeError:
			landscapeState.key === landscapeKey ? landscapeState.error : null,
		reloadLandscape: () => loadLandscape(true),
		structure:
			structureState.key === generationKey ? structureState.data : null,
		structureStatus:
			structureState.key === generationKey ? structureState.status : "idle",
		structureError:
			structureState.key === generationKey ? structureState.error : null,
		reloadStructure: () => loadStructure(true),
		ontologyHandoff:
			ontologyState.key === generationKey ? ontologyState.data : null,
		ontologyStatus:
			ontologyState.key === generationKey ? ontologyState.status : "idle",
		ontologyError:
			ontologyState.key === generationKey ? ontologyState.error : null,
		reloadOntology: () => loadOntology(true),
	};
}
