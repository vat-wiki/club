// Re-export shared error types from @club/shared.
// @club/sdk wraps and re-exports these so consumers can import everything
// from one package.
export {
  ClubApiError,
  formatError,
  isClubApiError,
  isNetworkFailure,
  parseHttpErrorStatus,
  type ClubApiErrorStatus,
  type HttpStatusCode,
  type NetworkFailureStatus,
  NETWORK_ERROR_STATUS,
} from "@club/shared";
