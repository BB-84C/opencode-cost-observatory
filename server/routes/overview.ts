import { Router } from "express"

import { buildOverview } from "../services/dashboard-analytics"
import { parseDashboardWindowQuery } from "../services/window-range"

export function overviewRoutes(analyticsDbPath: string) {
  const router = Router()

  router.get("/overview/lifetime", (req, res) => {
    const hasWindow = Object.prototype.hasOwnProperty.call(req.query, "window")
    const now = Math.floor(Date.now() / 1000)

    if (!hasWindow) {
      res.json(buildOverview(analyticsDbPath, now, undefined))
      return
    }

    try {
      const parsedWindow = parseDashboardWindowQuery(req.query, new Date(now * 1000))
      res.json(buildOverview(analyticsDbPath, now, parsedWindow))
    } catch (error) {
      res.status(400).json({
        error: "invalid_window",
        message: error instanceof Error ? error.message : "Invalid window",
      })
    }
  })

  return router
}
