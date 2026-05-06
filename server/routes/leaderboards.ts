import { Router } from "express"

import { buildCostSessionLeaderboard, buildTokenSessionLeaderboard } from "../services/dashboard-analytics"
import { tryRespondWithAnalyticsBusy } from "../services/sqlite-busy"

function parseLimit(raw: unknown) {
  if (raw == null || raw === "") {
    return null
  }

  if (typeof raw !== "string") {
    return Number.NaN
  }

  const limit = Number.parseInt(raw, 10)
  return Number.isInteger(limit) && limit > 0 ? limit : Number.NaN
}

export function leaderboardsRoutes(analyticsDbPath: string, pricingDbPath: string) {
  const router = Router()

  router.get("/leaderboards/token-sessions", (req, res) => {
    const limit = parseLimit(req.query.limit)
    if (Number.isNaN(limit)) {
      res.status(400).json({ error: "invalid_leaderboard_request" })
      return
    }

    try {
      res.json(buildTokenSessionLeaderboard(analyticsDbPath, pricingDbPath, limit ?? undefined))
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      throw error
    }
  })

  router.get("/leaderboards/cost-sessions", (req, res) => {
    const limit = parseLimit(req.query.limit)
    if (Number.isNaN(limit)) {
      res.status(400).json({ error: "invalid_leaderboard_request" })
      return
    }

    try {
      res.json(buildCostSessionLeaderboard(analyticsDbPath, pricingDbPath, limit ?? undefined))
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      throw error
    }
  })

  router.get("/leaderboards/expensive-sessions", (req, res) => {
    const limit = parseLimit(req.query.limit)
    if (Number.isNaN(limit)) {
      res.status(400).json({ error: "invalid_leaderboard_request" })
      return
    }

    try {
      const result = buildCostSessionLeaderboard(analyticsDbPath, pricingDbPath, limit ?? undefined)
      res.json({ ...result, rows: result.sessions })
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      throw error
    }
  })

  return router
}
