// Errors thrown by the SDK transport layer. ClubApiError carries the HTTP
// status when one was received; synthetic errors (timeout, network) use
// conventional non-2xx codes so callers can branch uniformly. A status of 0
// denotes a network failure with no HTTP response.
export class ClubApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ClubApiError";
  }
}
