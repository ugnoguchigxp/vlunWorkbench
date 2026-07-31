type RequestInitJson = Omit<RequestInit, "body"> & {
	body?: unknown;
};

export const UNAUTHORIZED_EVENT_NAME = "vuln-workbench:unauthorized";

let lastUnauthorizedEventAt = 0;
let refreshRequest: Promise<boolean> | null = null;

const notifyUnauthorized = () => {
	if (typeof window === "undefined") return;
	const now = Date.now();
	if (now - lastUnauthorizedEventAt < 500) return;
	lastUnauthorizedEventAt = now;
	window.dispatchEvent(new Event(UNAUTHORIZED_EVENT_NAME));
};

const isAuthPath = (path: string): boolean => path.startsWith("/api/auth/");

const canRetryWithRefresh = (path: string): boolean =>
	!isAuthPath(path) || path === "/api/auth/me";

const shouldNotifyUnauthorized = (path: string): boolean =>
	path !== "/api/auth/login";

const parseErrorMessage = async (response: Response): Promise<string> => {
	let message = `Request failed: ${response.status}`;
	try {
		const data = (await response.json()) as { message?: string };
		if (data.message) message = data.message;
	} catch {
		// Ignore parse errors for non-JSON responses.
	}
	return message;
};

const refreshAuthSession = async (): Promise<boolean> => {
	if (!refreshRequest) {
		refreshRequest = fetch("/api/auth/refresh", {
			method: "POST",
			credentials: "include",
		})
			.then((response) => response.ok)
			.catch(() => false)
			.finally(() => {
				refreshRequest = null;
			});
	}
	return refreshRequest;
};

export async function requestJson<T>(
	path: string,
	init?: RequestInitJson,
): Promise<T> {
	const response = await executeWithAuthRefresh(path, init);
	if (!response.ok) await throwResponseError(path, response);
	return (await response.json()) as T;
}

export async function requestVoid(
	path: string,
	init?: RequestInitJson,
): Promise<void> {
	const response = await executeWithAuthRefresh(path, init);
	if (!response.ok) await throwResponseError(path, response);
}

async function executeWithAuthRefresh(
	path: string,
	init?: RequestInitJson,
): Promise<Response> {
	const execute = async (): Promise<Response> => {
		const headers = new Headers(init?.headers);
		if (init?.body !== undefined && !headers.has("Content-Type")) {
			headers.set("Content-Type", "application/json");
		}
		const { body, ...restInit } = init || {};
		return fetch(path, {
			...restInit,
			headers,
			credentials: "include",
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
	};

	let response = await execute();
	if (response.status === 401 && canRetryWithRefresh(path)) {
		if (await refreshAuthSession()) response = await execute();
	}
	return response;
}

async function throwResponseError(path: string, response: Response) {
	if (response.status === 401 && shouldNotifyUnauthorized(path)) {
		notifyUnauthorized();
	}
	throw new Error(await parseErrorMessage(response));
}
