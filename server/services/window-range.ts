export type PresetDashboardWindow = "1h" | "24h" | "7d" | "30d" | "90d" | "all"

export type ParsedDashboardWindow = {
  mode: "preset" | "custom"
  preset?: PresetDashboardWindow
  label: string
  start: Date
  end: Date
}

type QueryLike = Record<string, unknown>

const PRESET_MS: Record<PresetDashboardWindow, number | null> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  all: null,
}

const PRESET_LABELS: Record<PresetDashboardWindow, string> = {
  "1h": "1H",
  "24h": "24H",
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  all: "ALL",
}

function stringParam(query: QueryLike, key: string): string | undefined {
  const value = query[key]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function requireStringWindowShape(query: QueryLike) {
  if ("window" in query && typeof query.window !== "string") {
    throw new Error("Window must be a single string value")
  }
}

function parseDateOnly(value: string, endOfDay: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}`)
  }

  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"
  const date = new Date(`${value}${suffix}`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid date: ${value}`)
  }

  return date
}

export function parseDashboardWindowQuery(query: QueryLike, now = new Date()): ParsedDashboardWindow {
  requireStringWindowShape(query)
  const mode = stringParam(query, "window") ?? "24h"

  if (mode === "custom") {
    const startValue = stringParam(query, "start")
    const endValue = stringParam(query, "end")
    if (!startValue || !endValue) {
      throw new Error("Custom window requires start and end dates")
    }

    const start = parseDateOnly(startValue, false)
    const end = parseDateOnly(endValue, true)
    if (end.getTime() < start.getTime()) {
      throw new Error("Custom window end date must be on or after start date")
    }
    const today = now.toISOString().slice(0, 10)
    if (startValue > today || endValue > today) {
      throw new Error("Custom window dates must not be in the future")
    }

    return { mode: "custom", label: `${startValue} → ${endValue}`, start, end }
  }

  if (!(mode in PRESET_MS)) {
    throw new Error(`Unsupported window: ${mode}`)
  }

  const preset = mode as PresetDashboardWindow
  const duration = PRESET_MS[preset]
  return {
    mode: "preset",
    preset,
    label: PRESET_LABELS[preset],
    start: duration === null ? new Date(0) : new Date(now.getTime() - duration),
    end: now,
  }
}
