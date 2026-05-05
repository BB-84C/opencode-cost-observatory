import { Router } from "express"

import { buildSeries, type SeriesGranularity, type SeriesMetric } from "../services/dashboard-analytics"
import { parseDashboardWindowQuery } from "../services/window-range"

const validGranularities = new Set<SeriesGranularity>(["hourly", "daily", "weekly", "monthly"])
const validMetrics = new Set<SeriesMetric>(["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "cost"])

function parseGranularity(raw: string | undefined): SeriesGranularity | null {
  if (!raw) {
    return "daily"
  }

  return validGranularities.has(raw as SeriesGranularity) ? raw as SeriesGranularity : null
}

function parseMetrics(raw: unknown): SeriesMetric[] | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "cost"]
  }

  const metrics = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))]
  return metrics.every((metric) => validMetrics.has(metric as SeriesMetric)) ? metrics as SeriesMetric[] : null
}

export function seriesRoutes(analyticsDbPath: string) {
  const router = Router()

  router.get("/series/:granularity", (req, res) => {
    const granularity = parseGranularity(req.params.granularity)
    const metrics = parseMetrics(req.query.metrics)
    const rawWindow = req.query.window

    if (!granularity || !metrics) {
      res.status(400).json({ error: "invalid_series_request" })
      return
    }

    if (rawWindow != null && typeof rawWindow !== "string") {
      res.status(400).json({
        error: "invalid_window",
        message: "Window must be a single string value",
      })
      return
    }

    try {
      const parsedWindow = typeof rawWindow === "string"
        ? parseDashboardWindowQuery(req.query, new Date(Date.now()))
        : null
      res.json(buildSeries(analyticsDbPath, {
        granularity,
        metrics,
        window: parsedWindow ?? "all",
      }))
    } catch (error) {
      res.status(400).json({
        error: "invalid_window",
        message: error instanceof Error ? error.message : "Invalid window",
      })
    }
  })

  return router
}
