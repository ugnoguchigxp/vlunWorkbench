export function ToastRegion({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<div className="workspace-toast-region" aria-live="polite">
			{message}
		</div>
	);
}
