import { useCallback, useEffect, useRef, useState } from "react";
import type { StaticIntelligenceOntologyHandoff } from "../../../../shared/schemas/static-intelligence-module.schema";
import {
	fetchProjectOntologyHandoff,
	fetchProjectStructureFiles,
	fetchProjectStructureReferences,
	fetchProjectStructureSummary,
	type ProjectStructureFilesResponse,
	type ProjectStructureReferencesResponse,
	type ProjectStructureSummaryResponse,
} from "../../api";

export type IntelligenceResourceStatus =
	| "idle"
	| "loading"
	| "loaded"
	| "failed";

const errorMessage = (error: unknown, fallback: string): string =>
	error instanceof Error ? error.message : fallback;

type SummaryState = {
	key: string | null;
	status: IntelligenceResourceStatus;
	data: ProjectStructureSummaryResponse | null;
	error: string | null;
};

export function useProjectStructureSummary({
	projectId,
	scanRunId,
	generationId,
}: {
	projectId: string;
	scanRunId: string | null;
	generationId: string | null;
}) {
	const requestId = useRef(0);
	const key =
		scanRunId && generationId
			? `${projectId}:${scanRunId}:${generationId}`
			: null;
	const [state, setState] = useState<SummaryState>({
		key: null,
		status: "idle",
		data: null,
		error: null,
	});
	const load = useCallback(
		async (force = false) => {
			if (!key || !scanRunId || !generationId) return;
			if (!force && state.key === key && state.status !== "idle") return;
			const currentRequest = ++requestId.current;
			setState((current) => ({
				key,
				status: "loading",
				data: current.key === key ? current.data : null,
				error: null,
			}));
			try {
				const data = await fetchProjectStructureSummary(
					projectId,
					scanRunId,
					generationId,
				);
				if (requestId.current !== currentRequest) return;
				setState({ key, status: "loaded", data, error: null });
			} catch (error) {
				if (requestId.current !== currentRequest) return;
				setState((current) => ({
					key,
					status: "failed",
					data: current.key === key ? current.data : null,
					error: errorMessage(
						error,
						"プロジェクト構造を読み込めませんでした。",
					),
				}));
			}
		},
		[generationId, key, projectId, scanRunId, state.key, state.status],
	);
	useEffect(() => {
		void load();
	}, [load]);
	return {
		data: state.key === key ? state.data : null,
		status: state.key === key ? state.status : "idle",
		error: state.key === key ? state.error : null,
		reload: () => load(true),
	};
}

type FilesState = {
	key: string | null;
	status: IntelligenceResourceStatus;
	items: ProjectStructureFilesResponse["items"];
	nextCursor: number | null;
	total: number | null;
	error: string | null;
};

export function useProjectStructureFiles({
	projectId,
	scanRunId,
	generationId,
	moduleId,
	query = "",
	enabled = true,
}: {
	projectId: string;
	scanRunId: string;
	generationId: string;
	moduleId: string | null;
	query?: string;
	enabled?: boolean;
}) {
	const requestId = useRef(0);
	const normalizedQuery = query.trim();
	const key =
		enabled && moduleId
			? `${projectId}:${scanRunId}:${generationId}:${moduleId}:${normalizedQuery}`
			: null;
	const [state, setState] = useState<FilesState>({
		key: null,
		status: "idle",
		items: [],
		nextCursor: null,
		total: null,
		error: null,
	});
	const load = useCallback(
		async (force = false) => {
			if (!key || !moduleId) return;
			if (!force && state.key === key && state.status !== "idle") return;
			const currentRequest = ++requestId.current;
			setState((current) => ({
				key,
				status: "loading",
				items: current.key === key ? current.items : [],
				nextCursor: current.key === key ? current.nextCursor : null,
				total: current.key === key ? current.total : null,
				error: null,
			}));
			try {
				const response = await fetchProjectStructureFiles(
					projectId,
					scanRunId,
					{
						generationId,
						moduleId,
						query: normalizedQuery || undefined,
						limit: 100,
					},
				);
				if (requestId.current !== currentRequest) return;
				setState({
					key,
					status: "loaded",
					items: response.items,
					nextCursor: response.nextCursor,
					total: response.total ?? response.items.length,
					error: null,
				});
			} catch (error) {
				if (requestId.current !== currentRequest) return;
				setState((current) => ({
					...current,
					key,
					status: "failed",
					error: errorMessage(
						error,
						"モジュールのファイルを読み込めませんでした。",
					),
				}));
			}
		},
		[
			generationId,
			key,
			moduleId,
			normalizedQuery,
			projectId,
			scanRunId,
			state.key,
			state.status,
		],
	);
	const loadMore = useCallback(async () => {
		if (
			!key ||
			!moduleId ||
			state.nextCursor === null ||
			state.status === "loading"
		)
			return;
		const cursor = state.nextCursor;
		const currentRequest = ++requestId.current;
		setState((current) => ({ ...current, status: "loading", error: null }));
		try {
			const response = await fetchProjectStructureFiles(projectId, scanRunId, {
				generationId,
				moduleId,
				query: normalizedQuery || undefined,
				cursor,
				limit: 100,
			});
			if (requestId.current !== currentRequest) return;
			setState((current) => ({
				...current,
				status: "loaded",
				items: [...current.items, ...response.items],
				nextCursor: response.nextCursor,
				total: response.total ?? current.total,
				error: null,
			}));
		} catch (error) {
			if (requestId.current !== currentRequest) return;
			setState((current) => ({
				...current,
				status: "failed",
				error: errorMessage(error, "追加のファイルを読み込めませんでした。"),
			}));
		}
	}, [
		generationId,
		key,
		moduleId,
		normalizedQuery,
		projectId,
		scanRunId,
		state.nextCursor,
		state.status,
	]);
	useEffect(() => {
		void load();
	}, [load]);
	return {
		items: state.key === key ? state.items : [],
		status: state.key === key ? state.status : "idle",
		error: state.key === key ? state.error : null,
		nextCursor: state.key === key ? state.nextCursor : null,
		total: state.key === key ? state.total : null,
		reload: () => load(true),
		loadMore,
	};
}

type ReferencesState = {
	key: string | null;
	status: IntelligenceResourceStatus;
	data: ProjectStructureReferencesResponse | null;
	error: string | null;
};

export function useProjectStructureReferences({
	projectId,
	scanRunId,
	generationId,
	moduleId,
	enabled,
}: {
	projectId: string;
	scanRunId: string;
	generationId: string;
	moduleId: string | null;
	enabled: boolean;
}) {
	const requestId = useRef(0);
	const key =
		enabled && moduleId
			? `${projectId}:${scanRunId}:${generationId}:${moduleId}`
			: null;
	const [state, setState] = useState<ReferencesState>({
		key: null,
		status: "idle",
		data: null,
		error: null,
	});
	const load = useCallback(
		async (force = false) => {
			if (!key || !moduleId) return;
			if (!force && state.key === key && state.status !== "idle") return;
			const currentRequest = ++requestId.current;
			setState((current) => ({
				key,
				status: "loading",
				data: current.key === key ? current.data : null,
				error: null,
			}));
			try {
				const data = await fetchProjectStructureReferences(
					projectId,
					scanRunId,
					{
						generationId,
						moduleId,
						direction: "both",
						limit: 500,
					},
				);
				if (requestId.current !== currentRequest) return;
				setState({ key, status: "loaded", data, error: null });
			} catch (error) {
				if (requestId.current !== currentRequest) return;
				setState((current) => ({
					key,
					status: "failed",
					data: current.key === key ? current.data : null,
					error: errorMessage(error, "参照関係を読み込めませんでした。"),
				}));
			}
		},
		[
			generationId,
			key,
			moduleId,
			projectId,
			scanRunId,
			state.key,
			state.status,
		],
	);
	const loadMore = useCallback(async () => {
		const cursor = state.data?.nextCursor;
		if (
			!key ||
			!moduleId ||
			cursor === null ||
			cursor === undefined ||
			state.status === "loading"
		)
			return;
		const currentRequest = ++requestId.current;
		setState((current) => ({ ...current, status: "loading", error: null }));
		try {
			const response = await fetchProjectStructureReferences(
				projectId,
				scanRunId,
				{
					generationId,
					moduleId,
					direction: "both",
					cursor,
					limit: 500,
				},
			);
			if (requestId.current !== currentRequest) return;
			setState((current) => ({
				...current,
				status: "loaded",
				data: current.data
					? {
							...response,
							items: [...current.data.items, ...response.items],
						}
					: response,
				error: null,
			}));
		} catch (error) {
			if (requestId.current !== currentRequest) return;
			setState((current) => ({
				...current,
				status: "failed",
				error: errorMessage(error, "追加の参照関係を読み込めませんでした。"),
			}));
		}
	}, [
		generationId,
		key,
		moduleId,
		projectId,
		scanRunId,
		state.data?.nextCursor,
		state.status,
	]);
	useEffect(() => {
		void load();
	}, [load]);
	return {
		data: state.key === key ? state.data : null,
		status: state.key === key ? state.status : "idle",
		error: state.key === key ? state.error : null,
		reload: () => load(true),
		loadMore,
	};
}

type HandoffState = {
	key: string | null;
	status: IntelligenceResourceStatus;
	data: StaticIntelligenceOntologyHandoff | null;
	error: string | null;
};

export function useOntologyHandoff({
	projectId,
	scanRunId,
	generationId,
	enabled,
}: {
	projectId: string;
	scanRunId: string;
	generationId: string;
	enabled: boolean;
}) {
	const requestId = useRef(0);
	const key = enabled ? `${projectId}:${scanRunId}:${generationId}` : null;
	const [state, setState] = useState<HandoffState>({
		key: null,
		status: "idle",
		data: null,
		error: null,
	});
	const load = useCallback(
		async (force = false) => {
			if (!key) return;
			if (!force && state.key === key && state.status !== "idle") return;
			const currentRequest = ++requestId.current;
			setState((current) => ({
				key,
				status: "loading",
				data: current.key === key ? current.data : null,
				error: null,
			}));
			try {
				const data = await fetchProjectOntologyHandoff(
					projectId,
					scanRunId,
					generationId,
				);
				if (requestId.current !== currentRequest) return;
				setState({ key, status: "loaded", data, error: null });
			} catch (error) {
				if (requestId.current !== currentRequest) return;
				setState((current) => ({
					key,
					status: "failed",
					data: current.key === key ? current.data : null,
					error: errorMessage(
						error,
						"Ontology Handoffを読み込めませんでした。",
					),
				}));
			}
		},
		[generationId, key, projectId, scanRunId, state.key, state.status],
	);
	useEffect(() => {
		void load();
	}, [load]);
	return {
		data: state.key === key ? state.data : null,
		status: state.key === key ? state.status : "idle",
		error: state.key === key ? state.error : null,
		reload: () => load(true),
	};
}
