// Re-export shared error types from @club/shared.
// @club/sdk wraps and re-exports these so consumers can import everything
// from one package.
export {
  ClubApiError,
  type ClubApiErrorStatus,
  formatError,
  type HttpStatusCode,
  isClubApiError,
  isNetworkFailure,
  NETWORK_ERROR_STATUS,
  type NetworkFailureStatus,
  parseHttpErrorStatus,
} from "@club/shared";
