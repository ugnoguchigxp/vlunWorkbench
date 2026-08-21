import { useCallback, useEffect } from "react";
import {
	fetchFinding,
	fetchFindingDecisions,
	fetchFindingDynamicRuns,
	fetchFindingReproductions,
	fetchFindingReviews,
	fetchProjectDynamicProfiles,
	fetchReproductionProfiles,
} from "../../../api";
import type { ScanDetailTab } from "../workspace/use-scan-launch-state";
import type {
	FindingSelectionBundle,
	FindingVerificationBundle,
	ScanFindingsState,
} from "./use-scan-findings-state";

type FindingLoadEffectsScope = Pick<
	ScanFindingsState,
	| "findingLoadInFlightRef"
	| "findingSelectionCacheRef"
	| "findingVerificationCacheRef"
	| "findingVerificationInFlightRef"
	| "selectedFindingDetails"
	| "selectedFindingId"
	| "selectedFindingIdRef"
	| "setAllDecisions"
	| "setAllReviews"
	| "setDynamicProfiles"
	| "setDynamicRuns"
	| "setReproProfiles"
	| "setReproRuns"
	| "setSelectedDynamicProfile"
	| "setSelectedFindingDetails"
	| "setSelectedReproProfile"
	| "setVerificationDataLoadedFindingId"
> & {
	active: boolean;
	runWithBusy: (task: () => Promise<void>) => Promise<boolean>;
	scanDetailTab: ScanDetailTab;
};

export function useFindingLoadEffects(scope: FindingLoadEffectsScope) {
	const {
		active,
		findingLoadInFlightRef,
		findingSelectionCacheRef,
		findingVerificationCacheRef,
		findingVerificationInFlightRef,
		runWithBusy,
		scanDetailTab,
		selectedFindingDetails,
		selectedFindingId,
		selectedFindingIdRef,
		setAllDecisions,
		setAllReviews,
		setDynamicProfiles,
		setDynamicRuns,
		setReproProfiles,
		setReproRuns,
		setSelectedDynamicProfile,
		setSelectedFindingDetails,
		setSelectedReproProfile,
		setVerificationDataLoadedFindingId,
	} = scope;
	const applyFindingSelectionBundle = useCallback(
		(findingId: string, bundle: FindingSelectionBundle) => {
			if (selectedFindingIdRef.current !== findingId) return;
			setSelectedFindingDetails(bundle.details);
			setAllReviews(bundle.reviews);
			setAllDecisions(bundle.decisions);
		},
		[
			setSelectedFindingDetails,
			setAllReviews,
			setAllDecisions,
			selectedFindingIdRef.current,
		],
	);

	const applyFindingVerificationBundle = useCallback(
		(findingId: string, bundle: FindingVerificationBundle) => {
			if (selectedFindingIdRef.current !== findingId) return;
			setReproProfiles(bundle.reproductionProfiles);
			setSelectedReproProfile(bundle.selectedReproductionProfile);
			setReproRuns(bundle.reproductions);
			setDynamicProfiles(bundle.dynamicProfiles);
			setSelectedDynamicProfile(bundle.selectedDynamicProfile);
			setDynamicRuns(bundle.dynamicRuns);
			setVerificationDataLoadedFindingId(findingId);
		},
		[
			setReproRuns,
			setVerificationDataLoadedFindingId,
			setReproProfiles,
			setSelectedDynamicProfile,
			setSelectedReproProfile,
			setDynamicRuns,
			setDynamicProfiles,
			selectedFindingIdRef.current,
		],
	);

	const loadFindingDetails = useCallback(
		async (findingId: string, quiet = false, forceRefresh = false) => {
			const fetchAction = async () => {
				if (!forceRefresh) {
					const cached = findingSelectionCacheRef.current.get(findingId);
					if (cached) {
						applyFindingSelectionBundle(findingId, cached);
						return;
					}
					const inFlight = findingLoadInFlightRef.current.get(findingId);
					if (inFlight) {
						await inFlight;
						const loaded = findingSelectionCacheRef.current.get(findingId);
						if (loaded) applyFindingSelectionBundle(findingId, loaded);
						return;
					}
				}
				const request = (async () => {
					const details = await fetchFinding(findingId);
					const [reviewsResult, decisionsResult] = await Promise.all([
						fetchFindingReviews(findingId).catch(() => ({ reviews: [] })),
						fetchFindingDecisions(findingId).catch(() => ({ decisions: [] })),
					]);
					const bundle: FindingSelectionBundle = {
						details,
						reviews: reviewsResult.reviews,
						decisions: decisionsResult.decisions,
					};
					findingSelectionCacheRef.current.set(findingId, bundle);
					applyFindingSelectionBundle(findingId, bundle);
				})();
				findingLoadInFlightRef.current.set(findingId, request);
				try {
					await request;
				} finally {
					findingLoadInFlightRef.current.delete(findingId);
				}
			};
			if (quiet) {
				await fetchAction().catch((err) =>
					console.error("Failed to silently reload finding details:", err),
				);
			} else {
				await runWithBusy(fetchAction);
			}
		},
		[
			applyFindingSelectionBundle,
			runWithBusy,
			findingSelectionCacheRef.current.get,
			findingSelectionCacheRef.current.set,
			findingLoadInFlightRef.current.set,
			findingLoadInFlightRef.current.get,
			findingLoadInFlightRef.current.delete,
		],
	);

	const loadFindingVerification = useCallback(
		async (findingId: string) => {
			const cached = findingVerificationCacheRef.current.get(findingId);
			if (cached) {
				applyFindingVerificationBundle(findingId, cached);
				return;
			}
			const inFlight = findingVerificationInFlightRef.current.get(findingId);
			if (inFlight) {
				await inFlight;
				const loaded = findingVerificationCacheRef.current.get(findingId);
				if (loaded) applyFindingVerificationBundle(findingId, loaded);
				return;
			}
			const request = (async () => {
				const detailsInFlight = findingLoadInFlightRef.current.get(findingId);
				if (detailsInFlight) await detailsInFlight;
				const details =
					findingSelectionCacheRef.current.get(findingId)?.details ??
					(await fetchFinding(findingId));
				const [
					reproductionProfilesResult,
					reproductionsResult,
					dynamicProfilesResult,
					dynamicRunsResult,
				] = await Promise.all([
					fetchReproductionProfiles(findingId).catch(() => ({ profiles: [] })),
					fetchFindingReproductions(findingId).catch(() => ({
						reproductions: [],
					})),
					fetchProjectDynamicProfiles(details.finding.projectId).catch(() => ({
						configs: [],
					})),
					fetchFindingDynamicRuns(findingId).catch(() => ({
						dynamicRuns: [],
					})),
				]);
				const bundle: FindingVerificationBundle = {
					reproductionProfiles: reproductionProfilesResult.profiles,
					selectedReproductionProfile:
						reproductionProfilesResult.profiles.find((p) => p.isApplicable)
							?.id ?? "",
					reproductions: reproductionsResult.reproductions,
					dynamicProfiles: dynamicProfilesResult.configs,
					selectedDynamicProfile:
						dynamicProfilesResult.configs.find((p) => p.enabled)?.profileId ??
						"",
					dynamicRuns: dynamicRunsResult.dynamicRuns,
				};
				findingVerificationCacheRef.current.set(findingId, bundle);
				applyFindingVerificationBundle(findingId, bundle);
			})();
			findingVerificationInFlightRef.current.set(findingId, request);
			try {
				await request;
			} finally {
				findingVerificationInFlightRef.current.delete(findingId);
			}
		},
		[
			applyFindingVerificationBundle,
			findingVerificationInFlightRef.current.delete,
			findingSelectionCacheRef.current.get,
			findingVerificationInFlightRef.current.get,
			findingVerificationInFlightRef.current.set,
			findingVerificationCacheRef.current.set,
			findingVerificationCacheRef.current.get,
			findingLoadInFlightRef.current.get,
		],
	);

	useEffect(() => {
		if (!active || !selectedFindingId) {
			setSelectedFindingDetails(null);
			setAllReviews([]);
			setAllDecisions([]);
			setReproProfiles([]);
			setSelectedReproProfile("");
			setReproRuns([]);
			setDynamicProfiles([]);
			setSelectedDynamicProfile("");
			setDynamicRuns([]);
			setVerificationDataLoadedFindingId(null);
			return;
		}
		void loadFindingDetails(selectedFindingId);
	}, [
		active,
		selectedFindingId,
		loadFindingDetails,
		setSelectedReproProfile,
		setAllDecisions,
		setSelectedFindingDetails,
		setSelectedDynamicProfile,
		setAllReviews,
		setReproProfiles,
		setDynamicRuns,
		setReproRuns,
		setVerificationDataLoadedFindingId,
		setDynamicProfiles,
	]);

	useEffect(() => {
		if (!active || scanDetailTab !== "verification" || !selectedFindingId)
			return;
		void loadFindingVerification(selectedFindingId).catch((err) =>
			console.error("Failed to load finding verification data:", err),
		);
	}, [active, scanDetailTab, selectedFindingId, loadFindingVerification]);

	useEffect(() => {
		if (
			!active ||
			!selectedFindingId ||
			selectedFindingDetails?.latestReview?.status !== "running"
		)
			return;
		let mounted = true;
		const poll = setInterval(() => {
			void fetchFinding(selectedFindingId)
				.then((res) => {
					if (!mounted) return;
					setSelectedFindingDetails(res);
					if (res.latestReview?.status !== "running") {
						clearInterval(poll);
						void fetchFindingReviews(selectedFindingId).then(({ reviews }) =>
							setAllReviews(reviews),
						);
					}
				})
				.catch(console.error);
		}, 2500);
		return () => {
			mounted = false;
			clearInterval(poll);
		};
	}, [
		active,
		selectedFindingId,
		selectedFindingDetails?.latestReview?.status,
		setSelectedFindingDetails,
		setAllReviews,
	]);

	return { loadFindingDetails };
}
