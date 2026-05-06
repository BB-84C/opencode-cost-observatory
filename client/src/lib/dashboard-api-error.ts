export class DashboardApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    public readonly retryable: boolean,
    public readonly payload: unknown,
  ) {
    super(code ? `dashboard_request_failed:${status}:${code}` : `dashboard_request_failed:${status}`)
  }
}

export function isRetryableAnalyticsBusyError(error: unknown) {
  return error instanceof DashboardApiError
    && error.status === 503
    && error.code === "analytics_db_busy"
    && error.retryable
}
