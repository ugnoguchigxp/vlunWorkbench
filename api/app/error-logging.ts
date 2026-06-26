import { HTTPException } from "hono/http-exception";
import { HttpError } from "../modules/auth/errors";

export function shouldLogAppError(error: unknown): boolean {
	if (error instanceof HttpError) {
		return error.status >= 500;
	}
	if (error instanceof HTTPException) {
		return error.status >= 500;
	}
	return true;
}
