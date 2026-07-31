import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import {
	type AdminUser,
	createAdminUser,
	disableAdminUser,
	enableAdminUser,
	fetchAdminUsers,
	resetAdminUserPassword,
	updateAdminUser,
} from "./api";

export type AdminUserManagementPanelProps = {
	busy: boolean;
	runWithBusy: (task: () => Promise<void>) => Promise<boolean>;
	setErrorText: (value: string | null) => void;
};

type AdminFormMode = "create" | "edit";

type AdminFilters = {
	role: "all" | "admin" | "member";
	status: "all" | "active" | "disabled";
};

type AdminUserManagementContextValue = {
	busy: boolean;
	adminUsers: AdminUser[];
	filteredAdminUsers: AdminUser[];
	searchInput: string;
	filters: AdminFilters;
	adminFormOpen: boolean;
	adminFormMode: AdminFormMode;
	adminFormEmail: string;
	adminFormDisplayName: string;
	adminFormRole: "admin" | "member";
	adminFormPassword: string;
	adminResetUser: AdminUser | null;
	adminResetPassword: string;
	adminToggleUser: AdminUser | null;
	setSearchInput: (value: string) => void;
	setFilters: (next: Partial<AdminFilters>) => void;
	applySearch: () => void;
	clearFilters: () => void;
	openCreateForm: () => void;
	openEditForm: (user: AdminUser) => void;
	closeForm: () => void;
	setAdminFormEmail: (value: string) => void;
	setAdminFormDisplayName: (value: string) => void;
	setAdminFormRole: (value: "admin" | "member") => void;
	setAdminFormPassword: (value: string) => void;
	submitForm: () => Promise<void>;
	openToggleDialog: (user: AdminUser) => void;
	closeToggleDialog: () => void;
	confirmToggleUser: () => Promise<void>;
	openResetDialog: (user: AdminUser) => void;
	closeResetDialog: () => void;
	setAdminResetPassword: (value: string) => void;
	confirmResetPassword: () => Promise<void>;
};

const AdminUserManagementContext =
	createContext<AdminUserManagementContextValue | null>(null);

export const useAdminUserManagement = (): AdminUserManagementContextValue => {
	const context = useContext(AdminUserManagementContext);
	if (!context) {
		throw new Error("useAdminUserManagement must be used within its provider.");
	}
	return context;
};

const toSearchTerms = (value: string): string[] =>
	value
		.toLowerCase()
		.split(/\s+/)
		.filter((term) => term.length > 0);

const includeUserByTerms = (user: AdminUser, terms: string[]): boolean => {
	if (terms.length === 0) return true;
	const haystack = [
		user.displayName,
		user.email,
		user.role,
		user.isActive ? "active" : "disabled",
	]
		.join(" ")
		.toLowerCase();
	return terms.every((term) => haystack.includes(term));
};

const includeUserByFilters = (
	user: AdminUser,
	filters: AdminFilters,
): boolean => {
	const matchesRole = filters.role === "all" || user.role === filters.role;
	const matchesStatus =
		filters.status === "all" ||
		(filters.status === "active" ? user.isActive : !user.isActive);
	return matchesRole && matchesStatus;
};

const toEmptyFilters = (): AdminFilters => ({
	role: "all",
	status: "all",
});

export const AdminUserManagementProvider = ({
	busy,
	runWithBusy,
	setErrorText,
	children,
}: AdminUserManagementPanelProps & { children: ReactNode }) => {
	const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
	const [searchInput, setSearchInput] = useState("");
	const [searchKeyword, setSearchKeyword] = useState("");
	const [filters, setFiltersState] = useState<AdminFilters>(toEmptyFilters());
	const [adminFormOpen, setAdminFormOpen] = useState(false);
	const [adminFormMode, setAdminFormMode] = useState<AdminFormMode>("create");
	const [adminEditingUser, setAdminEditingUser] = useState<AdminUser | null>(
		null,
	);
	const [adminFormEmail, setAdminFormEmail] = useState("");
	const [adminFormDisplayName, setAdminFormDisplayName] = useState("");
	const [adminFormRole, setAdminFormRole] = useState<"admin" | "member">(
		"member",
	);
	const [adminFormPassword, setAdminFormPassword] = useState("");
	const [adminResetUser, setAdminResetUser] = useState<AdminUser | null>(null);
	const [adminResetPassword, setAdminResetPassword] = useState("");
	const [adminToggleUser, setAdminToggleUser] = useState<AdminUser | null>(
		null,
	);

	const loadAdminUsers = useCallback(async () => {
		const users = await fetchAdminUsers();
		setAdminUsers(users);
	}, []);

	useEffect(() => {
		void loadAdminUsers().catch((error) => {
			setErrorText(
				error instanceof Error ? error.message : "Failed to load users.",
			);
		});
	}, [loadAdminUsers, setErrorText]);

	const filteredAdminUsers = useMemo(() => {
		const terms = toSearchTerms(searchKeyword);
		return adminUsers.filter(
			(user) =>
				includeUserByFilters(user, filters) && includeUserByTerms(user, terms),
		);
	}, [adminUsers, filters, searchKeyword]);

	const resetForm = () => {
		setAdminFormOpen(false);
		setAdminFormMode("create");
		setAdminEditingUser(null);
		setAdminFormEmail("");
		setAdminFormDisplayName("");
		setAdminFormRole("member");
		setAdminFormPassword("");
	};

	const setFilters = (next: Partial<AdminFilters>) => {
		setFiltersState((previous) => ({ ...previous, ...next }));
	};

	const applySearch = () => setSearchKeyword(searchInput.trim());

	const clearFilters = () => {
		setSearchInput("");
		setSearchKeyword("");
		setFiltersState(toEmptyFilters());
	};

	const openCreateForm = () => {
		setErrorText(null);
		setAdminFormMode("create");
		setAdminEditingUser(null);
		setAdminFormEmail("");
		setAdminFormDisplayName("");
		setAdminFormRole("member");
		setAdminFormPassword("");
		setAdminFormOpen(true);
	};

	const openEditForm = (user: AdminUser) => {
		setErrorText(null);
		setAdminFormMode("edit");
		setAdminEditingUser(user);
		setAdminFormEmail(user.email);
		setAdminFormDisplayName(user.displayName);
		setAdminFormRole(user.role);
		setAdminFormPassword("");
		setAdminFormOpen(true);
	};

	const closeForm = () => {
		if (busy) return;
		setAdminFormOpen(false);
		setAdminEditingUser(null);
		setAdminFormPassword("");
	};

	const submitForm = async () => {
		const displayName = adminFormDisplayName.trim();
		if (!displayName) {
			setErrorText("Display name is required.");
			return;
		}

		if (adminFormMode === "create") {
			const email = adminFormEmail.trim();
			if (!email) {
				setErrorText("Email is required.");
				return;
			}
			if (adminFormPassword.length < 8) {
				setErrorText("Password must be at least 8 characters.");
				return;
			}
			const ok = await runWithBusy(async () => {
				await createAdminUser({
					email,
					displayName,
					role: adminFormRole,
					initialPassword: adminFormPassword,
				});
				await loadAdminUsers();
			});
			if (ok) resetForm();
			return;
		}

		if (!adminEditingUser) return;
		const ok = await runWithBusy(async () => {
			await updateAdminUser(adminEditingUser.id, {
				displayName,
				role: adminFormRole,
			});
			await loadAdminUsers();
		});
		if (ok) resetForm();
	};

	const openToggleDialog = (user: AdminUser) => {
		setErrorText(null);
		setAdminToggleUser(user);
	};
	const closeToggleDialog = () => {
		if (!busy) setAdminToggleUser(null);
	};
	const confirmToggleUser = async () => {
		if (!adminToggleUser) return;
		const ok = await runWithBusy(async () => {
			if (adminToggleUser.isActive) {
				await disableAdminUser(adminToggleUser.id);
			} else {
				await enableAdminUser(adminToggleUser.id);
			}
			await loadAdminUsers();
		});
		if (ok) setAdminToggleUser(null);
	};

	const openResetDialog = (user: AdminUser) => {
		setErrorText(null);
		setAdminResetUser(user);
		setAdminResetPassword("");
	};
	const closeResetDialog = () => {
		if (busy) return;
		setAdminResetUser(null);
		setAdminResetPassword("");
	};
	const confirmResetPassword = async () => {
		if (!adminResetUser) return;
		if (adminResetPassword.length < 8) {
			setErrorText("Password must be at least 8 characters.");
			return;
		}
		const ok = await runWithBusy(async () => {
			await resetAdminUserPassword(adminResetUser.id, adminResetPassword);
			await loadAdminUsers();
		});
		if (ok) {
			setAdminResetUser(null);
			setAdminResetPassword("");
		}
	};

	const value: AdminUserManagementContextValue = {
		busy,
		adminUsers,
		filteredAdminUsers,
		searchInput,
		filters,
		adminFormOpen,
		adminFormMode,
		adminFormEmail,
		adminFormDisplayName,
		adminFormRole,
		adminFormPassword,
		adminResetUser,
		adminResetPassword,
		adminToggleUser,
		setSearchInput,
		setFilters,
		applySearch,
		clearFilters,
		openCreateForm,
		openEditForm,
		closeForm,
		setAdminFormEmail,
		setAdminFormDisplayName,
		setAdminFormRole,
		setAdminFormPassword,
		submitForm,
		openToggleDialog,
		closeToggleDialog,
		confirmToggleUser,
		openResetDialog,
		closeResetDialog,
		setAdminResetPassword,
		confirmResetPassword,
	};

	return (
		<AdminUserManagementContext.Provider value={value}>
			{children}
		</AdminUserManagementContext.Provider>
	);
};
