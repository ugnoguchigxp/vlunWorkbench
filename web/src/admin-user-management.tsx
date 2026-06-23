import {
	CircleCheck,
	CircleOff,
	KeyRound,
	Pencil,
	Plus,
	RefreshCw,
	Search,
	Users,
	X,
} from "lucide-react";
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
import { Button, IconButton, SelectInput, TextInput } from "./ui";

type AdminUserManagementPanelProps = {
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

const useAdminUserManagement = (): AdminUserManagementContextValue => {
	const context = useContext(AdminUserManagementContext);
	if (!context) {
		throw new Error("useAdminUserManagement must be used within its provider.");
	}
	return context;
};

const formatDateTime = (value: string | null | undefined): string => {
	if (!value) return "-";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
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

const AdminUserManagementProvider = ({
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
		setFiltersState((previous) => ({
			...previous,
			...next,
		}));
	};

	const applySearch = () => {
		setSearchKeyword(searchInput.trim());
	};

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
			if (ok) {
				resetForm();
			}
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
		if (ok) {
			resetForm();
		}
	};

	const openToggleDialog = (user: AdminUser) => {
		setErrorText(null);
		setAdminToggleUser(user);
	};

	const closeToggleDialog = () => {
		if (busy) return;
		setAdminToggleUser(null);
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
		if (ok) {
			setAdminToggleUser(null);
		}
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

const AdminToolbar = () => {
	const {
		busy,
		searchInput,
		filters,
		setSearchInput,
		setFilters,
		applySearch,
		clearFilters,
		openCreateForm,
	} = useAdminUserManagement();
	return (
		<>
			<div className="panel-header admin-users-header">
				<div className="admin-users-title">
					<Users className="icon" />
					<h2>User Management</h2>
				</div>
				<Button
					type="button"
					variant="primary"
					className="admin-create-btn"
					onClick={openCreateForm}
					disabled={busy}
				>
					<Plus className="icon" />
					<span>Add user</span>
				</Button>
			</div>
			<div className="admin-toolbar">
				<form
					className="admin-search-form"
					onSubmit={(event) => {
						event.preventDefault();
						applySearch();
					}}
				>
					<div className="search-input-wrapper">
						<Search className="admin-search-icon" />
						<TextInput
							type="search"
							className="search-input admin-search-input"
							value={searchInput}
							onChange={(event) => setSearchInput(event.target.value)}
							placeholder="Search by name, email, role..."
						/>
					</div>
					<Button type="submit" variant="primary" disabled={busy}>
						<Search className="icon" />
						<span>Search</span>
					</Button>
				</form>
				<div className="admin-filter-row">
					<SelectInput
						value={filters.role}
						onChange={(event) =>
							setFilters({
								role: event.target.value as "all" | "admin" | "member",
							})
						}
					>
						<option value="all">All roles</option>
						<option value="admin">Admin</option>
						<option value="member">Member</option>
					</SelectInput>
					<SelectInput
						value={filters.status}
						onChange={(event) =>
							setFilters({
								status: event.target.value as "all" | "active" | "disabled",
							})
						}
					>
						<option value="all">All status</option>
						<option value="active">Active</option>
						<option value="disabled">Disabled</option>
					</SelectInput>
					<Button
						type="button"
						variant="outline"
						className="admin-clear-btn"
						onClick={clearFilters}
						disabled={busy}
					>
						<RefreshCw className="icon" />
						<span>Clear</span>
					</Button>
				</div>
			</div>
		</>
	);
};

const AdminUsersTable = () => {
	const {
		busy,
		adminUsers,
		filteredAdminUsers,
		openEditForm,
		openToggleDialog,
		openResetDialog,
	} = useAdminUserManagement();
	return (
		<>
			<div className="admin-users-summary">
				<small>
					Showing {filteredAdminUsers.length} / {adminUsers.length} users
				</small>
			</div>
			<div className="admin-users-table-wrap">
				<table className="admin-users-table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Email</th>
							<th>Role</th>
							<th>Status</th>
							<th>Last Login</th>
							<th>Created</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						{filteredAdminUsers.map((user) => (
							<tr key={user.id}>
								<td>
									<div className="admin-user-name">{user.displayName}</div>
								</td>
								<td>{user.email}</td>
								<td>
									<span className={`admin-role-pill ${user.role}`}>
										{user.role}
									</span>
								</td>
								<td>
									<span
										className={`admin-status-pill ${
											user.isActive ? "active" : "disabled"
										}`}
									>
										{user.isActive ? "active" : "disabled"}
									</span>
								</td>
								<td>{formatDateTime(user.lastLoginAt)}</td>
								<td>{formatDateTime(user.createdAt)}</td>
								<td>
									<div className="admin-row-actions">
										<Button
											type="button"
											variant="outline"
											className="admin-row-btn"
											onClick={() => openEditForm(user)}
											disabled={busy}
											title="Edit user"
										>
											<Pencil className="icon" />
											<span>Edit</span>
										</Button>
										<Button
											type="button"
											variant={user.isActive ? "destructive" : "primary"}
											className={`admin-row-btn ${
												user.isActive
													? "admin-row-btn-danger"
													: "admin-row-btn-success"
											}`}
											onClick={() => openToggleDialog(user)}
											disabled={busy}
											title={user.isActive ? "Disable user" : "Enable user"}
										>
											{user.isActive ? (
												<CircleOff className="icon" />
											) : (
												<CircleCheck className="icon" />
											)}
											<span>{user.isActive ? "Disable" : "Enable"}</span>
										</Button>
										<Button
											type="button"
											variant="outline"
											className="admin-row-btn"
											onClick={() => openResetDialog(user)}
											disabled={busy}
											title="Reset password"
										>
											<KeyRound className="icon" />
											<span>Reset PW</span>
										</Button>
									</div>
								</td>
							</tr>
						))}
						{filteredAdminUsers.length === 0 ? (
							<tr>
								<td colSpan={7} className="admin-empty">
									No users found for the selected filters.
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		</>
	);
};

const AdminUserFormModal = () => {
	const {
		busy,
		adminFormOpen,
		adminFormMode,
		adminFormEmail,
		adminFormDisplayName,
		adminFormRole,
		adminFormPassword,
		setAdminFormEmail,
		setAdminFormDisplayName,
		setAdminFormRole,
		setAdminFormPassword,
		closeForm,
		submitForm,
	} = useAdminUserManagement();

	if (!adminFormOpen) return null;

	return (
		<div className="admin-modal-backdrop">
			<section className="admin-modal" role="dialog" aria-modal="true">
				<header className="admin-modal-header">
					<h3>{adminFormMode === "create" ? "Create User" : "Edit User"}</h3>
					<IconButton
						type="button"
						className="admin-modal-close-btn"
						onClick={closeForm}
						disabled={busy}
						aria-label="Close"
						title="Close"
					>
						<X className="icon" />
					</IconButton>
				</header>
				<div className="admin-modal-body">
					<label htmlFor="admin-form-email">
						Email
						<TextInput
							id="admin-form-email"
							type="email"
							value={adminFormEmail}
							onChange={(event) => setAdminFormEmail(event.target.value)}
							placeholder="user@example.com"
							disabled={adminFormMode === "edit"}
						/>
					</label>
					<label htmlFor="admin-form-display-name">
						Display name
						<TextInput
							id="admin-form-display-name"
							type="text"
							value={adminFormDisplayName}
							onChange={(event) => setAdminFormDisplayName(event.target.value)}
							placeholder="User Name"
						/>
					</label>
					<label htmlFor="admin-form-role">
						Role
						<SelectInput
							id="admin-form-role"
							value={adminFormRole}
							onChange={(event) =>
								setAdminFormRole(event.target.value as "admin" | "member")
							}
						>
							<option value="member">member</option>
							<option value="admin">admin</option>
						</SelectInput>
					</label>
					{adminFormMode === "create" ? (
						<label htmlFor="admin-form-password">
							Initial password
							<TextInput
								id="admin-form-password"
								type="password"
								value={adminFormPassword}
								onChange={(event) => setAdminFormPassword(event.target.value)}
								placeholder="min 8 chars"
							/>
						</label>
					) : null}
				</div>
				<footer className="admin-modal-footer">
					<Button
						type="button"
						variant="outline"
						onClick={closeForm}
						disabled={busy}
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant="primary"
						onClick={() => void submitForm()}
						disabled={busy}
					>
						{adminFormMode === "create" ? "Create" : "Save"}
					</Button>
				</footer>
			</section>
		</div>
	);
};

const AdminUserToggleDialog = () => {
	const { busy, adminToggleUser, closeToggleDialog, confirmToggleUser } =
		useAdminUserManagement();
	if (!adminToggleUser) return null;
	return (
		<div className="admin-modal-backdrop">
			<section
				className="admin-modal admin-confirm-modal"
				role="dialog"
				aria-modal="true"
			>
				<header className="admin-modal-header">
					<h3>{adminToggleUser.isActive ? "Disable User" : "Enable User"}</h3>
				</header>
				<div className="admin-modal-body">
					<p>
						{adminToggleUser.isActive
							? `${adminToggleUser.displayName} (${adminToggleUser.email}) will be disabled.`
							: `${adminToggleUser.displayName} (${adminToggleUser.email}) will be enabled.`}
					</p>
				</div>
				<footer className="admin-modal-footer">
					<Button
						type="button"
						variant="outline"
						onClick={closeToggleDialog}
						disabled={busy}
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant={adminToggleUser.isActive ? "destructive" : "primary"}
						className={adminToggleUser.isActive ? "admin-btn-danger" : ""}
						onClick={() => void confirmToggleUser()}
						disabled={busy}
					>
						{adminToggleUser.isActive ? "Disable" : "Enable"}
					</Button>
				</footer>
			</section>
		</div>
	);
};

const AdminUserResetPasswordDialog = () => {
	const {
		busy,
		adminResetUser,
		adminResetPassword,
		closeResetDialog,
		setAdminResetPassword,
		confirmResetPassword,
	} = useAdminUserManagement();
	if (!adminResetUser) return null;
	return (
		<div className="admin-modal-backdrop">
			<section
				className="admin-modal admin-confirm-modal"
				role="dialog"
				aria-modal="true"
			>
				<header className="admin-modal-header">
					<h3>Reset Password</h3>
				</header>
				<div className="admin-modal-body">
					<p>{adminResetUser.email}</p>
					<label htmlFor="admin-reset-password">
						New password
						<TextInput
							id="admin-reset-password"
							type="password"
							value={adminResetPassword}
							onChange={(event) => setAdminResetPassword(event.target.value)}
							placeholder="min 8 chars"
						/>
					</label>
				</div>
				<footer className="admin-modal-footer">
					<Button
						type="button"
						variant="outline"
						onClick={closeResetDialog}
						disabled={busy}
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant="primary"
						onClick={() => void confirmResetPassword()}
						disabled={busy}
					>
						Update password
					</Button>
				</footer>
			</section>
		</div>
	);
};

export const AdminUserManagementPanel = ({
	busy,
	runWithBusy,
	setErrorText,
}: AdminUserManagementPanelProps) => (
	<AdminUserManagementProvider
		busy={busy}
		runWithBusy={runWithBusy}
		setErrorText={setErrorText}
	>
		<main className="layout columns-1">
			<section className="panel">
				<AdminToolbar />
				<AdminUsersTable />
			</section>
			<AdminUserFormModal />
			<AdminUserToggleDialog />
			<AdminUserResetPasswordDialog />
		</main>
	</AdminUserManagementProvider>
);
