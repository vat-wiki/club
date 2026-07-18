// Re-export shared error types from @club/shared.
// @club/sdk wraps and re-exports these so consumers can import everything
// from one package.
export { ClubApiError, formatError } from "@club/shared";
