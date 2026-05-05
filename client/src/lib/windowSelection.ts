export type PresetWindow = "24h" | "7d" | "30d" | "90d" | "all"

export type DashboardWindowSelection =
  | { mode: "preset"; preset: PresetWindow }
  | { mode: "custom"; start: string; end: string }

const PRESET_LABELS: Record<PresetWindow, string> = {
  "24h": "24H",
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  all: "ALL",
}

export function windowSelectionToQuery(selection: DashboardWindowSelection): URLSearchParams {
  const params = new URLSearchParams()

  if (selection.mode === "preset") {
    params.set("window", selection.preset)
    return params
  }

  params.set("window", "custom")
  params.set("start", selection.start)
  params.set("end", selection.end)
  return params
}

export function describeWindowSelection(selection: DashboardWindowSelection): string {
  if (selection.mode === "preset") {
    return PRESET_LABELS[selection.preset]
  }

  return `${selection.start} → ${selection.end}`
}

export function isValidCustomWindow(start: string, end: string) {
  return Boolean(start && end && end >= start)
}
