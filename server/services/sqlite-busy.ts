type JsonResponder = {
  status(code: number): JsonResponder
  json(body: unknown): JsonResponder
}

export function isSqliteBusyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message)
}

export function tryRespondWithAnalyticsBusy(res: JsonResponder, error: unknown) {
  if (!isSqliteBusyError(error)) {
    return false
  }

  res.status(503).json({
    error: "analytics_db_busy",
    retryable: true,
    message: "Analytics store is temporarily busy during refresh",
  })
  return true
}
