import { Router } from "express"

import { openAnalyticsReadonlyDb } from "../storage/db"

const CACHE_SECONDS = 300
const DAY_MS = 24 * 60 * 60 * 1000
const cellSize = 10
const cellGap = 3
const topPadding = 20
const leftPadding = 30

const palettes = {
  light: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  dark: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
} as const

type Theme = keyof typeof palettes
type HeatmapCacheEntry = {
  svg: string
  expiresAt: number
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

function startOfUtcDay(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function addUtcDays(timestamp: number, days: number) {
  return timestamp + days * DAY_MS
}

function formatDateKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function parseTheme(raw: unknown): Theme {
  return raw === "dark" ? "dark" : "light"
}

function parseDays(raw: unknown) {
  if (raw === "90" || raw === "180" || raw === "365") {
    return Number(raw)
  }

  return 365
}

function readDailyTokens(analyticsDbPath: string, sinceUtcMs: number) {
  const db = openAnalyticsReadonlyDb(analyticsDbPath)
  try {
    const rows = db.sqlite.prepare(`
      select date(datetime(time_created / 1000, 'unixepoch')) as day, sum(total_tokens) as totalTokens
      from message_usage_fact
      where time_created >= ?
      group by day
    `).all(sinceUtcMs) as Array<{ day: string, totalTokens: number }>

    return new Map(rows.map((row) => [row.day, row.totalTokens]))
  } finally {
    db.sqlite.close()
  }
}

function colorIndex(total: number, max: number) {
  if (total <= 0 || max <= 0) {
    return 0
  }

  const score = Math.log10(total + 1) / Math.log10(max + 1)
  if (score <= 0.25) return 1
  if (score <= 0.5) return 2
  if (score <= 0.75) return 3
  return 4
}

function buildHeatmapSvg(analyticsDbPath: string, theme: Theme, days: number) {
  const today = startOfUtcDay(new Date())
  const start = addUtcDays(today, -(days - 1))
  const gridStartDate = new Date(start)
  const gridStart = addUtcDays(start, -gridStartDate.getUTCDay())
  const totalCells = Math.floor((today - gridStart) / DAY_MS) + 1
  const weeks = Math.ceil(totalCells / 7)
  const dailyTokens = readDailyTokens(analyticsDbPath, start)
  const maxDailyTokens = Math.max(0, ...dailyTokens.values())
  const colors = palettes[theme]
  const width = leftPadding + weeks * (cellSize + cellGap) + 55
  const height = topPadding + 7 * (cellSize + cellGap) + 32
  const textColor = theme === "dark" ? "#8b949e" : "#57606a"
  const background = theme === "dark" ? '<rect width="100%" height="100%" fill="#0d1117" rx="6" />' : ""
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const monthLabels: string[] = []
  const cells: string[] = []

  for (let week = 0; week < weeks; week += 1) {
    for (let day = 0; day < 7; day += 1) {
      const timestamp = addUtcDays(gridStart, week * 7 + day)
      if (timestamp > today) {
        continue
      }

      const date = new Date(timestamp)
      const key = formatDateKey(timestamp)
      const total = dailyTokens.get(key) ?? 0
      const x = leftPadding + week * (cellSize + cellGap)
      const y = topPadding + day * (cellSize + cellGap)

      if (date.getUTCDate() <= 7 && day === 0) {
        monthLabels.push(`<text x="${x}" y="12" fill="${textColor}" font-size="10">${monthNames[date.getUTCMonth()]}</text>`)
      }

      cells.push(`<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${colors[colorIndex(total, maxDailyTokens)]}"><title>${escapeXml(key)}: ${total} tokens</title></rect>`)
    }
  }

  const dayLabels = [
    `<text x="0" y="${topPadding + 2 * (cellSize + cellGap) + 9}" fill="${textColor}" font-size="10">Mon</text>`,
    `<text x="0" y="${topPadding + 4 * (cellSize + cellGap) + 9}" fill="${textColor}" font-size="10">Wed</text>`,
    `<text x="0" y="${topPadding + 6 * (cellSize + cellGap) + 9}" fill="${textColor}" font-size="10">Fri</text>`,
  ]
  const legendY = height - 12
  const legendX = width - 100
  const legendCells = colors.map((color, index) => {
    return `<rect x="${legendX + 28 + index * (cellSize + 3)}" y="${legendY - 9}" width="${cellSize}" height="${cellSize}" rx="2" fill="${color}" />`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="OpenCode token usage heatmap">${background}${monthLabels.join("")}${dayLabels.join("")}${cells.join("")}<text x="${legendX}" y="${legendY}" fill="${textColor}" font-size="10">Less</text>${legendCells.join("")}<text x="${legendX + 28 + colors.length * (cellSize + 3) + 4}" y="${legendY}" fill="${textColor}" font-size="10">More</text></svg>`
}

export function publicHeatmapRoutes(analyticsDbPath: string) {
  const router = Router()
  const cache = new Map<string, HeatmapCacheEntry>()

  router.get("/heatmap/tokens.svg", (req, res) => {
    const theme = parseTheme(req.query.theme)
    const days = parseDays(req.query.days)
    const cacheKey = `${theme}:${days}`
    const now = Date.now()
    let entry = cache.get(cacheKey)

    if (!entry || entry.expiresAt <= now) {
      entry = {
        svg: buildHeatmapSvg(analyticsDbPath, theme, days),
        expiresAt: now + CACHE_SECONDS * 1000,
      }
      cache.set(cacheKey, entry)
    }

    res.setHeader("Cache-Control", `public, max-age=${CACHE_SECONDS}`)
    res.type("image/svg+xml")
    res.send(entry.svg)
  })

  return router
}
