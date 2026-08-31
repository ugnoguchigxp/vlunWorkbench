import type { FailureKind } from "../../../shared/schemas/failure.schema";

export class HttpError extends Error {
	constructor(
		public readonly status: number,
		message: string,
		public readonly kind?: FailureKind,
		public readonly code?: string,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = "HttpError";
	}
}
