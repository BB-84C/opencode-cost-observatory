import { Router } from "express"

import { buildCostSessionLeaderboard, buildTokenSessionLeaderboard } from "../services/dashboard-analytics"
import { tryRespondWithAnalyticsBusy } from "../services/sqlite-busy"
import { buildRequestCacheKey, sendJsonWithOptionalCache } from "../utils/response-cache"

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

type DashboardRouteOptions = { cachePrivateResponses?: boolean }

export function leaderboardsRoutes(analyticsDbPath: string, pricingDbPath: string, options: DashboardRouteOptions = {}) {
  const router = Router()
  const cacheEnabled = options.cachePrivateResponses === true

  router.get("/leaderboards/token-sessions", (req, res) => {
    const limit = parseLimit(req.query.limit)
    if (Number.isNaN(limit)) {
      res.status(400).json({ error: "invalid_leaderboard_request" })
      return
    }

    try {
      sendJsonWithOptionalCache(res, buildRequestCacheKey("leaderboards", req), cacheEnabled, () => buildTokenSessionLeaderboard(analyticsDbPath, pricingDbPath, limit ?? undefined))
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
      sendJsonWithOptionalCache(res, buildRequestCacheKey("leaderboards", req), cacheEnabled, () => buildCostSessionLeaderboard(analyticsDbPath, pricingDbPath, limit ?? undefined))
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
      sendJsonWithOptionalCache(res, buildRequestCacheKey("leaderboards", req), cacheEnabled, () => {
        const result = buildCostSessionLeaderboard(analyticsDbPath, pricingDbPath, limit ?? undefined)
        return { ...result, rows: result.sessions }
      })
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      throw error
    }
  })

  return router
}
