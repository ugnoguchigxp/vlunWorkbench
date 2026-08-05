import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	setQueryData: vi.fn(),
	useMutation: vi.fn((options) => options),
	useQuery: vi.fn((options) => options),
	useQueryClient: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useMutation: mocks.useMutation,
	useQuery: mocks.useQuery,
	useQueryClient: mocks.useQueryClient,
}));

import {
	authMeQueryKey,
	fetchMe,
	fetchProtectedProfile,
	protectedProfileQueryKey,
	useCurrentUserQuery,
	useLoginMutation,
	useLogoutMutation,
	useProtectedProfileQuery,
} from "./api";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.useQueryClient.mockReturnValue({
		setQueryData: mocks.setQueryData,
	});
});

describe("web API hooks", () => {
	it("configures current-user and protected-profile queries", () => {
		useCurrentUserQuery(false);
		useProtectedProfileQuery();

		expect(mocks.useQuery).toHaveBeenNthCalledWith(1, {
			queryKey: authMeQueryKey,
			queryFn: fetchMe,
			enabled: false,
		});
		expect(mocks.useQuery).toHaveBeenNthCalledWith(2, {
			queryKey: protectedProfileQueryKey,
			queryFn: fetchProtectedProfile,
			enabled: true,
		});
	});

	it("updates the current-user cache before the login callback", async () => {
		const onSuccess = vi.fn();
		const response = {
			user: {
				id: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
				email: "test@example.com",
				displayName: "Test User",
				role: "member",
			},
		};
		const variables = {
			email: response.user.email,
			password: "password123456",
		};

		useLoginMutation({ onSuccess });
		const options = mocks.useMutation.mock.calls[0]?.[0];
		await options.onSuccess(response, variables, undefined, {});

		expect(mocks.setQueryData).toHaveBeenCalledWith(
			authMeQueryKey,
			response.user,
		);
		expect(onSuccess).toHaveBeenCalledWith(response, variables, undefined, {});
	});

	it("clears the current-user cache before the logout callback", async () => {
		const onSettled = vi.fn();

		useLogoutMutation({ onSettled });
		const options = mocks.useMutation.mock.calls[0]?.[0];
		await options.onSettled(undefined, null, undefined, undefined, {});

		expect(mocks.setQueryData).toHaveBeenCalledWith(authMeQueryKey, null);
		expect(onSettled).toHaveBeenCalledWith(
			undefined,
			null,
			undefined,
			undefined,
			{},
		);
	});
});
