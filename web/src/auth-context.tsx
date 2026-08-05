import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import {
	authMeQueryKey,
	type AuthUser,
	UNAUTHORIZED_EVENT_NAME,
	useCurrentUserQuery,
	useLoginMutation,
	useLogoutMutation,
} from "./api";

type AuthContextValue = {
	authUser: AuthUser | null;
	authLoading: boolean;
	busy: boolean;
	errorText: string | null;
	loginWithPassword: (params: {
		email: string;
		password: string;
		redirectTo?: string;
	}) => Promise<boolean>;
	logoutCurrentUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const isUnauthorizedError = (error: unknown): boolean =>
	error instanceof Error &&
	(error.message === "Unauthorized" || error.message.includes("401"));

export function useAuth() {
	const value = useContext(AuthContext);
	if (!value) {
		throw new Error("AuthContext is missing.");
	}
	return value;
}

export function AuthProvider({
	children,
	sessionCheckEnabled = true,
}: {
	children: ReactNode;
	sessionCheckEnabled?: boolean;
}) {
	const navigate = useNavigate();
	const client = useQueryClient();
	const [errorText, setErrorText] = useState<string | null>(null);

	const meQuery = useCurrentUserQuery(sessionCheckEnabled);

	useEffect(() => {
		if (meQuery.error && !isUnauthorizedError(meQuery.error)) {
			setErrorText(
				meQuery.error instanceof Error
					? meQuery.error.message
					: "Failed to load app.",
			);
		}
	}, [meQuery.error]);

	useEffect(() => {
		const onUnauthorized = () => {
			client.setQueryData(authMeQueryKey, null);
			setErrorText("Session expired.");
		};
		window.addEventListener(UNAUTHORIZED_EVENT_NAME, onUnauthorized);
		return () =>
			window.removeEventListener(UNAUTHORIZED_EVENT_NAME, onUnauthorized);
	}, [client]);

	const loginMutation = useLoginMutation({
		onSuccess: async (_response, variables) => {
			setErrorText(null);
			await navigate({ to: variables.redirectTo ?? "/" });
		},
		onError: (error) => {
			setErrorText(error instanceof Error ? error.message : "Login failed.");
		},
	});

	const logoutMutation = useLogoutMutation({
		onSettled: async () => {
			setErrorText(null);
		},
	});

	const value = useMemo<AuthContextValue>(
		() => ({
			authUser: meQuery.data ?? null,
			authLoading: sessionCheckEnabled && meQuery.isPending,
			busy: loginMutation.isPending || logoutMutation.isPending,
			errorText,
			loginWithPassword: async (params) => {
				if (!params.email || !params.password) return false;
				try {
					await loginMutation.mutateAsync({
						email: params.email,
						password: params.password,
						redirectTo: params.redirectTo,
					});
					return true;
				} catch {
					return false;
				}
			},
			logoutCurrentUser: async () => {
				await logoutMutation.mutateAsync();
			},
		}),
		[
			errorText,
			loginMutation.isPending,
			loginMutation.mutateAsync,
			logoutMutation.isPending,
			logoutMutation.mutateAsync,
			meQuery.data,
			meQuery.isPending,
			sessionCheckEnabled,
		],
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
