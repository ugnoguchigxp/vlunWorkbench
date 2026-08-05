import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { ShowcaseSettingsProvider } from "./showcase-settings-context";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
		},
	},
});

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<ShowcaseSettingsProvider>
				<RouterProvider router={router} />
			</ShowcaseSettingsProvider>
		</QueryClientProvider>
	);
}
