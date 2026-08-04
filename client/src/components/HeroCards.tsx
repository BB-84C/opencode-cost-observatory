import type { OverviewResponse, SeriesPoint } from "../api/client"
import type { DashboardAlertItem } from "../hooks/useDashboardState"

type TrendMode = "cost" | "tokens"

function formatUsd(value: number | null, locale: Intl.LocalesArgument) {
  if (value == null) {
    return "--"
  }

  const fractionDigits = value >= 100 ? 0 : value >= 1 ? 2 : 4

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

function formatCompactNumber(value: number, locale: Intl.LocalesArgument) {
  return new Intl.NumberFormat(locale, {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value)
}

export function calculateLifetimeShare(lifetimeUsd: number | null, windowUsd: number | null) {
  if (lifetimeUsd == null || windowUsd == null || lifetimeUsd <= 0) {
    return null
  }

  return Math.round((windowUsd / lifetimeUsd) * 100)
}

function calculateTokenShare(lifetimeTokens: number, windowTokens: number | undefined) {
  if (lifetimeTokens <= 0 || windowTokens == null) {
    return null
  }

  return Math.round((windowTokens / lifetimeTokens) * 100)
}

function buildTrendBands(points: SeriesPoint[], mode: TrendMode): Array<{ key: string; color: string; values: number[] }> {
  const pick = (point: SeriesPoint) => {
    if (mode === "cost") {
      return [
        point.inputCostUsd ?? 0,
        (point.outputCostUsd ?? 0) + (point.reasoningCostUsd ?? 0),
        point.cacheReadCostUsd ?? 0,
        point.cacheWriteCostUsd ?? 0,
      ]
    }

    return [
      point.inputTokens ?? 0,
      (point.outputTokens ?? 0) + (point.reasoningTokens ?? 0),
      point.cacheReadTokens ?? 0,
      point.cacheWriteTokens ?? 0,
    ]
  }

  const colors = ["#4a87b9", "#f958aa", "#42b879", "#ff7437"]
  const bandValues: number[][] = [[], [], [], []]

  for (const point of points) {
    const values = pick(point)
    for (let band = 0; band < 4; band += 1) {
      bandValues[band]?.push(values[band] ?? 0)
    }
  }

  return colors.map((color, band) => ({ key: `band-${band}`, color, values: bandValues[band] ?? [] }))
}

function buildTrendPaths(points: SeriesPoint[], mode: TrendMode, width: number, height: number) {
  const bands = buildTrendBands(points, mode)
  const totals = points.map((_, index) => bands.reduce((sum, band) => sum + (band.values[index] ?? 0), 0))
  const maxTotal = Math.max(...totals, 0.000001)
  const xFor = (index: number) => points.length === 1 ? width / 2 : (index / (points.length - 1)) * width
  const yFor = (value: number) => height - ((value / maxTotal) * (height - 4))

  const cumulative = points.map((_, index) => {
    let running = 0
    return bands.map((band) => {
      running += band.values[index] ?? 0
      return running
    })
  })

  const paths = bands.map((band, bandIndex) => {
    if (points.length === 0) {
      return null
    }
    const topEdge = points.map((_, index) => `${xFor(index)},${yFor(cumulative[index]?.[bandIndex] ?? 0)}`)
    const bottomEdge = points.map((_, index) => {
      const previous = bandIndex === 0 ? 0 : (cumulative[index]?.[bandIndex - 1] ?? 0)
      return `${xFor(index)},${yFor(previous)}`
    }).reverse()
    return { key: band.key, color: band.color, path: `M ${topEdge.join(" L ")} L ${bottomEdge.join(" L ")} Z` }
  }).filter((entry): entry is { key: string; color: string; path: string } => entry != null)

  return { paths, maxTotal }
}

function formatWindowSpendChip(value: string, labels: { selectedWindowBadge: string }, locale: Intl.LocalesArgument) {
  const zh = typeof locale === "string" && locale.startsWith("zh")
  return zh ? `${labels.selectedWindowBadge}成本 ${value}` : `${labels.selectedWindowBadge} ${value}`
}

function formatWindowTokensChip(value: string, labels: { selectedWindowBadge: string }, locale: Intl.LocalesArgument) {
  const zh = typeof locale === "string" && locale.startsWith("zh")
  return zh ? `${labels.selectedWindowBadge}令牌 ${value}` : `${labels.selectedWindowBadge} ${value}`
}

export function HeroCards(props: {
  overview: OverviewResponse
  trendPoints: SeriesPoint[]
  activeAlerts: number
  activeAlertItems?: DashboardAlertItem[]
  labels: {
    lifetimeSpend: string
    totalTokens: string
    windowTokens: string
    activeAlerts: string
    never: string
    secondsShort: string
    minutesShort: string
    hoursShort: string
    daysShort: string
    trendStrip: string
    percentOfLifetime: string
    noWarnings: string
    selectedWindowBadge: string
  }
  isLoading: boolean
  locale: Intl.LocalesArgument
}) {
  const { overview, labels, isLoading, activeAlerts, locale } = props
  const alertItems = props.activeAlertItems ?? []
  const visibleAlertCount = props.activeAlertItems === undefined ? activeAlerts : alertItems.length
  const zh = typeof locale === "string" && locale.startsWith("zh")
  const spendShare = calculateLifetimeShare(overview.lifetimeSpendUsd, overview.windowSpendUsd)
  const tokenShare = calculateTokenShare(overview.lifetimeTokens, overview.windowTokens)
  const spendTrend = buildTrendPaths(props.trendPoints, "cost", 220, 56)
  const tokenTrend = buildTrendPaths(props.trendPoints, "tokens", 220, 56)

  return (
    <section className="hero-grid" aria-label={labels.lifetimeSpend}>
      <article className="hero-card hero-card--primary">
        <div className="hero-card__header">
          <span className="hero-card__label">{labels.lifetimeSpend}</span>
          <span className="hero-card__chip">$</span>
        </div>
        <strong className="hero-card__value">{isLoading ? "…" : formatUsd(overview.lifetimeSpendUsd, locale)}</strong>
        <div className="hero-card__chip-row">
          <span className="hero-card__chip hero-card__chip--warm">{formatWindowSpendChip(isLoading ? "…" : formatUsd(overview.windowSpendUsd, locale), labels, locale)}</span>
          <span className="hero-card__chip">{spendShare == null || isLoading ? "--" : `${spendShare}${labels.percentOfLifetime}`}</span>
        </div>
        <div className="hero-card__trend-strip" aria-label={labels.trendStrip}>
          {spendTrend.paths.length > 0 ? (
            <svg viewBox="0 0 220 56" className="hero-card__sparkline" role="img" aria-label={labels.trendStrip}>
              {spendTrend.paths.map((band) => (
                <path key={band.key} d={band.path} fill={band.color} opacity="0.9" />
              ))}
            </svg>
          ) : (
            <span>--</span>
          )}
        </div>
      </article>

      <article className="hero-card">
        <div className="hero-card__header">
          <span className="hero-card__label">{labels.totalTokens}</span>
          <span className="hero-card__chip">T</span>
        </div>
        <strong className="hero-card__value">{isLoading ? "…" : formatCompactNumber(overview.lifetimeTokens, locale)}</strong>
        <div className="hero-card__chip-row">
          <span className="hero-card__chip hero-card__chip--warm">{formatWindowTokensChip(isLoading ? "…" : formatCompactNumber(overview.windowTokens ?? 0, locale), labels, locale)}</span>
          <span className="hero-card__chip">{tokenShare == null || isLoading ? "--" : `${tokenShare}${labels.percentOfLifetime}`}</span>
        </div>
        <div className="hero-card__trend-strip" aria-label={labels.trendStrip}>
          {tokenTrend.paths.length > 0 ? (
            <svg viewBox="0 0 220 56" className="hero-card__sparkline" role="img" aria-label={labels.trendStrip}>
              {tokenTrend.paths.map((band) => (
                <path key={band.key} d={band.path} fill={band.color} opacity="0.9" />
              ))}
            </svg>
          ) : (
            <span>--</span>
          )}
        </div>
      </article>

      {alertItems.length > 0 ? (
        <div className="hero-card hero-card--alerts">
          <div className="hero-card__header">
            <span className="hero-card__label">{labels.activeAlerts}</span>
            <span className="hero-card__chip">{visibleAlertCount}</span>
          </div>
          <ul className="hero-card__alert-list" aria-label={labels.activeAlerts}>
            {alertItems.map((item) => (
              <li key={item.id} className="hero-card__alert-item">
                <strong>{item.title}</strong>
                <small>{zh ? ({ critical: "严重", warning: "警告", info: "信息" }[item.severity] ?? item.severity) : item.severity.slice(0, 1).toUpperCase() + item.severity.slice(1)}</small>
                <span>{item.detail}</span>
                <span>{zh ? "操作" : "Action"}: {item.action}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
