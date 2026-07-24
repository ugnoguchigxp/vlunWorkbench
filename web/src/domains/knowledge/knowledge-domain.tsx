import { KnowledgeWorkspace } from "../../knowledge-workspace";
import { useKnowledgeNavigation } from "./knowledge-navigation";

type KnowledgeDomainSectionProps = {
	active: boolean;
	isAdmin: boolean;
};

export const KnowledgeDomainSection = ({
	active,
	isAdmin,
}: KnowledgeDomainSectionProps) => {
	const { selection } = useKnowledgeNavigation();
	if (!active) return null;
	return (
		<KnowledgeWorkspace
			canManage={isAdmin}
			requestedSlug={selection.slug}
			requestedAt={selection.at}
		/>
	);
};
