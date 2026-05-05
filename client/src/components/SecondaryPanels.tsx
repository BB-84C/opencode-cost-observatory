import type { OverviewResponse, PricingRecordResponse, SeriesPoint } from "../api/client"
import { CollapsiblePanel } from "./CollapsiblePanel"

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatStatus(value: string, locale?: Intl.LocalesArgument) {
  const zh = typeof locale === "string" && locale.startsWith("zh")
  if (value === "stale") return zh ? "过期" : "Stale"
  if (value === "active") return zh ? "有效" : "Active"
  if (value === "disabled") return zh ? "已禁用" : "Disabled"
  return value
}

function localCopy(locale?: Intl.LocalesArgument) {
  const zh = typeof locale === "string" && locale.startsWith("zh")
  return zh
    ? { unavailable: "不可用", noActivity: "暂无活动", expand: "展开", collapse: "收起", formula: "公式：累计花费 ÷ 累计令牌 × 1,000,000。该值表示全部历史用量折算到每百万令牌的平均成本，用于比较模型组合与缓存策略变化。", partialFormula: "公式：已定价累计花费 ÷ 已定价令牌 × 1,000,000。该值仅基于已有价格覆盖的用量。", partial: "基于已定价令牌", coverage: "定价覆盖率" }
    : { unavailable: "Unavailable", noActivity: "No activity", expand: "Expand", collapse: "Collapse", formula: "Formula: lifetime spend ÷ lifetime tokens × 1,000,000. This expresses the all-time blended average cost per million tokens, useful for comparing model mix and cache strategy changes.", partialFormula: "Formula: lifetime spend ÷ priced tokens × 1,000,000. This value only uses usage covered by pricing records.", partial: "Based on priced tokens", coverage: "pricing coverage" }
}

export function SecondaryPanels(props: {
  overview: OverviewResponse
  points: SeriesPoint[]
  pricingRecords?: PricingRecordResponse[]
  locale?: Intl.LocalesArgument
  labels: {
    secondaryTitle: string
    cacheEfficiency: string
    pricingCoverage: string
    freshness: string
    activePricing: string
    effectiveCost: string
    source: string
  }
}) {
  const latest = props.points.at(-1)
  const cacheShare = latest && latest.cacheReadTokens != null
    ? latest.cacheReadTokens / Math.max(1, (latest.inputTokens ?? 0) + (latest.outputTokens ?? 0) + (latest.reasoningTokens ?? 0) + latest.cacheReadTokens + (latest.cacheWriteTokens ?? 0))
    : 0
  const pricingRows = (props.pricingRecords ?? []).filter((record) => record.enabled)
  const activePricing = pricingRows.filter((record) => record.enabled).length
  const freshness = pricingRows.reduce<number | null>((current, record) => {
    const value = record.observedTime ?? record.effectiveTime
    if (current == null) {
      return value
    }
    return Math.max(current, value)
  }, null)
  const effectiveCostTokens = props.overview.pricedTokens != null && props.overview.pricedTokens > 0 && props.overview.pricedTokens < props.overview.lifetimeTokens
    ? props.overview.pricedTokens
    : props.overview.lifetimeTokens
  const isPartialCoverage = props.overview.pricedTokens != null && props.overview.pricedTokens > 0 && props.overview.pricedTokens < props.overview.lifetimeTokens
  const effectiveCost = props.overview.lifetimeSpendUsd != null && effectiveCostTokens > 0
    ? (props.overview.lifetimeSpendUsd / effectiveCostTokens) * 1_000_000
    : null
  const copy = localCopy(props.locale)
  const effectiveCostLabel = effectiveCost == null
    ? copy.unavailable
    : new Intl.NumberFormat(props.locale, { style: "currency", currency: "USD", minimumFractionDigits: effectiveCost >= 100 ? 0 : 2, maximumFractionDigits: effectiveCost >= 100 ? 0 : 2 }).format(effectiveCost)
  const sourceBreakdown = pricingRows.reduce<Record<string, number>>((acc, record) => {
    acc[record.sourceType] = (acc[record.sourceType] ?? 0) + 1
    return acc
  }, {})

  return (
    <section className="secondary-panels" aria-label={props.labels.secondaryTitle}>
      <article className="secondary-panel">
        <span className="status-panel__label">{props.labels.cacheEfficiency}</span>
        <strong>{formatPercent(cacheShare)}</strong>
      </article>
      <article className="secondary-panel">
        <span className="status-panel__label">{props.labels.pricingCoverage}</span>
        <strong>{formatPercent(props.overview.priceCoverage)}</strong>
        <p className="hero-card__caption">{props.labels.activePricing}: {activePricing}</p>
        <p className="hero-card__caption">{props.labels.freshness}: {freshness == null ? copy.unavailable : new Date(freshness * 1000).toLocaleString(props.locale)}</p>
      </article>
      <CollapsiblePanel title={props.labels.effectiveCost} summary={effectiveCostLabel} defaultOpen className="secondary-panel" labels={{ expand: copy.expand, collapse: copy.collapse }}>
        <strong>{effectiveCostLabel}</strong>
        <p className="hero-card__caption">{isPartialCoverage ? copy.partialFormula : copy.formula}</p>
        {isPartialCoverage ? <p className="hero-card__caption">{copy.partial} · {formatPercent(props.overview.priceCoverage)} {copy.coverage}</p> : null}
        <p className="hero-card__caption">{props.labels.source}: {Object.entries(sourceBreakdown).map(([key, value]) => `${formatStatus(key, props.locale)} ${value}`).join(", ") || copy.unavailable}</p>
      </CollapsiblePanel>
    </section>
  )
}
