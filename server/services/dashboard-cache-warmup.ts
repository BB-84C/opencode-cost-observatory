import { buildCostSessionLeaderboard, buildOverview, buildSeries, buildTokenSessionLeaderboard, type SeriesMetric } from "./dashboard-analytics"
import { buildResponseCacheKey, dashboardPrivateResponseCache } from "../utils/response-cache"

const DASHBOARD_METRICS = "cost,inputTokens,outputTokens,reasoningTokens,cacheReadTokens,cacheWriteTokens"
const dashboardMetrics = DASHBOARD_METRICS.split(",") as SeriesMetric[]

type WarmupOptions = { analyticsDbPath: string; pricingDbPath: string; now?: number }

function warm(key: string, payload: unknown) {
  dashboardPrivateResponseCache.set(key, payload)
}

export function warmPrivateDashboardCache({ analyticsDbPath, pricingDbPath, now = Math.floor(Date.now() / 1000) }: WarmupOptions) {
  for (const window of ["24h", "7d", "30d"] as const) {
    warm(buildResponseCacheKey("overview", "/api/overview/lifetime", { window }), buildOverview(analyticsDbPath, pricingDbPath, now, window))
  }
  for (const window of ["24h", "7d", "30d"] as const) {
    warm(
      buildResponseCacheKey("series", "/api/series/daily", { metrics: DASHBOARD_METRICS, window }),
      buildSeries(analyticsDbPath, pricingDbPath, { granularity: "daily", metrics: dashboardMetrics, window, now }),
    )
  }
  for (const route of ["cost-sessions", "token-sessions"] as const) {
    warm(
      buildResponseCacheKey("leaderboards", `/api/leaderboards/${route}`, { limit: 5 }),
      route === "cost-sessions" ? buildCostSessionLeaderboard(analyticsDbPath, pricingDbPath, 5) : buildTokenSessionLeaderboard(analyticsDbPath, pricingDbPath, 5),
    )
  }
}

export function schedulePrivateDashboardCacheWarmup(options: WarmupOptions) {
  setTimeout(() => {
    try {
      warmPrivateDashboardCache(options)
    } catch (error) {
      console.warn("private dashboard cache warm-up failed", error)
    }
  }, 0)
}
