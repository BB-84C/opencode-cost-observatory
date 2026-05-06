import { Router } from "express"

import { getSyncRefreshLifecycle, queueSyncRefresh, readSyncState } from "../services/dashboard-analytics"
import { tryRespondWithAnalyticsBusy } from "../services/sqlite-busy"

export function syncRoutes(analyticsDbPath: string, rawDbPath: string) {
  const router = Router()

  router.get("/sync/status", (_req, res) => {
    try {
      res.json({
        state: readSyncState(analyticsDbPath),
        lifecycle: getSyncRefreshLifecycle(analyticsDbPath),
      })
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      throw error
    }
  })

  router.post("/sync/refresh", (_req, res) => {
    try {
      res.json(queueSyncRefresh(analyticsDbPath, rawDbPath))
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      res.status(500).json({
        status: "failed",
        error: error instanceof Error ? error.message : "sync_refresh_failed",
      })
    }
  })

  return router
}
