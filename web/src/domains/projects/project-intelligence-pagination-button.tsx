import { Button } from "../../ui";

export function IntelligencePaginationButton({
	loading,
	onLoadMore,
}: {
	loading: boolean;
	onLoadMore: () => void;
}) {
	return (
		<Button
			type="button"
			variant="secondary"
			onClick={onLoadMore}
			disabled={loading}
		>
			{loading ? "追加読込中…" : "さらにFindingを読み込む"}
		</Button>
	);
}
