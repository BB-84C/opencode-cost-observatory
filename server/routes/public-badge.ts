import { Router } from "express"

import { buildOverview } from "../services/dashboard-analytics"

const CACHE_SECONDS = 300

type BadgeCache = {
  message: string
  expiresAt: number
}

function formatCompactTokens(tokens: number) {
  if (tokens < 1_000) {
    return String(tokens)
  }

  const units = [
    { threshold: 1_000_000_000_000, suffix: "T" },
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ]

  const unit = units.find((candidate) => tokens >= candidate.threshold) ?? units[units.length - 1]
  const value = tokens / unit.threshold
  const formatted = value >= 100 ? Math.round(value).toString() : value.toFixed(1)
  return `${formatted}${unit.suffix}`
}

export function publicBadgeRoutes(analyticsDbPath: string, pricingDbPath: string) {
  const router = Router()
  let cache: BadgeCache | null = null

  router.get("/badge/tokens", (req, res) => {
    const now = Date.now()
    if (!cache || cache.expiresAt <= now) {
      cache = {
        message: formatCompactTokens(buildOverview(analyticsDbPath, pricingDbPath, Math.floor(now / 1000), "all").lifetimeTokens),
        expiresAt: now + CACHE_SECONDS * 1000,
      }
    }

    res.setHeader("Cache-Control", `public, max-age=${CACHE_SECONDS}`)
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.json({
      schemaVersion: 1,
      label: typeof req.query.label === "string" && req.query.label.trim() ? req.query.label.trim() : "lifetime tokens",
      message: cache.message,
      color: "blue",
      cacheSeconds: CACHE_SECONDS,
    })
  })

  return router
}
