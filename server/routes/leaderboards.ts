import { Router } from "express"

import { buildCostSessionLeaderboard, buildTokenSessionLeaderboard } from "../services/dashboard-analytics"

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

export function leaderboardsRoutes(analyticsDbPath: string) {
  const router = Router()

  router.get("/leaderboards/token-sessions", (req, res) => {
    const limit = parseLimit(req.query.limit)
    if (Number.isNaN(limit)) {
      res.status(400).json({ error: "invalid_leaderboard_request" })
      return
    }

    res.json(buildTokenSessionLeaderboard(analyticsDbPath, limit ?? undefined))
  })

  router.get("/leaderboards/cost-sessions", (req, res) => {
    const limit = parseLimit(req.query.limit)
    if (Number.isNaN(limit)) {
      res.status(400).json({ error: "invalid_leaderboard_request" })
      return
    }

    res.json(buildCostSessionLeaderboard(analyticsDbPath, limit ?? undefined))
  })

  router.get("/leaderboards/expensive-sessions", (req, res) => {
    const limit = parseLimit(req.query.limit)
    if (Number.isNaN(limit)) {
      res.status(400).json({ error: "invalid_leaderboard_request" })
      return
    }

    const result = buildCostSessionLeaderboard(analyticsDbPath, limit ?? undefined)
    res.json({ ...result, rows: result.sessions })
  })

  return router
}
