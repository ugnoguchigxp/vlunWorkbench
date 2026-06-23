import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { KnowledgeWorkspace } from "../../knowledge-workspace";

type KnowledgeSelection = {
	slug: string | null;
	at: number;
};

type KnowledgeNavigationContextValue = {
	selection: KnowledgeSelection;
	openKnowledge: (slug: string) => void;
};

type KnowledgeNavigationProviderProps = {
	children: ReactNode;
	onOpenKnowledge?: (slug: string) => void;
};

type KnowledgeDomainSectionProps = {
	active: boolean;
};

const KnowledgeNavigationContext =
	createContext<KnowledgeNavigationContextValue | null>(null);

export const KnowledgeNavigationProvider = ({
	children,
	onOpenKnowledge,
}: KnowledgeNavigationProviderProps) => {
	const [selection, setSelection] = useState<KnowledgeSelection>({
		slug: null,
		at: 0,
	});

	const openKnowledge = useCallback(
		(slug: string) => {
			if (!slug) return;
			setSelection((previous) => ({
				slug,
				at: previous.at + 1,
			}));
			onOpenKnowledge?.(slug);
		},
		[onOpenKnowledge],
	);

	const value = useMemo<KnowledgeNavigationContextValue>(
		() => ({
			selection,
			openKnowledge,
		}),
		[openKnowledge, selection],
	);

	return (
		<KnowledgeNavigationContext.Provider value={value}>
			{children}
		</KnowledgeNavigationContext.Provider>
	);
};

export const useKnowledgeNavigation = (): KnowledgeNavigationContextValue => {
	const context = useContext(KnowledgeNavigationContext);
	if (!context) {
		throw new Error(
			"useKnowledgeNavigation must be used within KnowledgeNavigationProvider.",
		);
	}
	return context;
};

export const KnowledgeDomainSection = ({
	active,
}: KnowledgeDomainSectionProps) => {
	const { selection } = useKnowledgeNavigation();
	if (!active) return null;
	return (
		<KnowledgeWorkspace
			requestedSlug={selection.slug}
			requestedAt={selection.at}
		/>
	);
};
