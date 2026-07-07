import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import { authRoutes, requireDashboardToken } from "./auth"
import { AppConfig, loadConfig } from "./config"
import { diagnosticsRoutes } from "./routes/diagnostics"
import { healthRoutes } from "./routes/health"
import { ingestRoutes } from "./routes/ingest"
import { leaderboardsRoutes } from "./routes/leaderboards"
import { overviewRoutes } from "./routes/overview"
import { pricingRoutes } from "./routes/pricing"
import { publicBadgeRoutes } from "./routes/public-badge"
import { publicHeatmapRoutes } from "./routes/public-heatmap"
import { seriesRoutes } from "./routes/series"
import { syncRoutes } from "./routes/sync"
import { queueColdStartAnalyticsRefresh } from "./services/cold-start-sync"
import { ensurePricingRegistryReady } from "./services/pricing-recovery"
import { bootstrapAnalyticsDb } from "./storage/db"

function formatHttpHost(host: string) {
  return host.includes(":") ? `[${host}]` : host
}

export function createServer(_config: AppConfig = loadConfig()) {
  bootstrapAnalyticsDb(_config.analyticsDbPath)
  ensurePricingRegistryReady(_config.analyticsDbPath, _config.pricingDbPath)

  const app = express()
  app.disable("x-powered-by")
  app.use(express.json({ limit: "10mb" }))
  app.use(healthRoutes())
  app.use(publicBadgeRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", publicBadgeRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(publicHeatmapRoutes(_config.analyticsDbPath))
  app.use("/api", publicHeatmapRoutes(_config.analyticsDbPath))

  if (_config.bb84VpsMode === "ingest") {
    app.use(ingestRoutes(_config.analyticsDbPath, _config.ingestToken!))
    app.use(overviewRoutes(_config.analyticsDbPath, _config.pricingDbPath))
    app.use(seriesRoutes(_config.analyticsDbPath, _config.pricingDbPath))
    app.use(leaderboardsRoutes(_config.analyticsDbPath, _config.pricingDbPath))
    app.use(pricingRoutes(_config.analyticsDbPath, _config.pricingDbPath))
    app.use("/api", ingestRoutes(_config.analyticsDbPath, _config.ingestToken!))
    app.use("/api", overviewRoutes(_config.analyticsDbPath, _config.pricingDbPath))
    app.use("/api", seriesRoutes(_config.analyticsDbPath, _config.pricingDbPath))
    app.use("/api", leaderboardsRoutes(_config.analyticsDbPath, _config.pricingDbPath))
    app.use("/api", pricingRoutes(_config.analyticsDbPath, _config.pricingDbPath))
    return app
  }

  app.use(authRoutes(_config.dashboardToken, { localAuthFilePath: _config.dashboardTokenFilePath }))
  app.use("/api", authRoutes(_config.dashboardToken, { localAuthFilePath: _config.dashboardTokenFilePath }))
  app.use(diagnosticsRoutes(_config.analyticsDbPath, _config.dashboardToken))
  app.use("/api", diagnosticsRoutes(_config.analyticsDbPath, _config.dashboardToken))
  app.use(requireDashboardToken(_config.dashboardToken))
  app.use(overviewRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(seriesRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(leaderboardsRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(pricingRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(syncRoutes(_config.analyticsDbPath, _config.opencodeDbPath))
  app.use("/api", overviewRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", seriesRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", leaderboardsRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", pricingRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", syncRoutes(_config.analyticsDbPath, _config.opencodeDbPath))
  return app
}

export async function startServer(config: AppConfig = loadConfig()) {
  const app = createServer(config)

  return await new Promise<import("node:http").Server>((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      console.log(`observatory backend listening on http://${formatHttpHost(config.host)}:${config.port}`)
      console.log("vite client is separate; run npm run dev for the browser scaffold")
      if (config.bb84VpsMode === "local") {
        try {
          queueColdStartAnalyticsRefresh(config.analyticsDbPath, config.opencodeDbPath)
        } catch (error) {
          console.warn("cold-start analytics refresh was not queued", error)
        }
      }
      resolve(server)
    })

    server.once("error", reject)
  })
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : ""
const modulePath = fileURLToPath(import.meta.url)

if (executedPath === modulePath) {
  void startServer()
}
