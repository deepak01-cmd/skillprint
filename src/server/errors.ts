export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "You do not have permission for this action", code = "forbidden") => new ApiError(403, code, msg);
export const bad = (msg: string, code = "invalid_request", details?: unknown) => new ApiError(400, code, msg, details);
export const conflict = (code: string, msg: string, details?: unknown) => new ApiError(409, code, msg, details);
export const unprocessable = (code: string, msg: string) => new ApiError(422, code, msg);
