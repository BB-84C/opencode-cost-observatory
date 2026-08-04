import { useState } from "react"

import type { DashboardStat, PricingCoverageGap, PricingRecordResponse, SeriesModelBucket, SeriesPoint } from "../api/client"
import type { DashboardWindow } from "../hooks/useDashboardState"
import { CollapsiblePanel } from "./CollapsiblePanel"
import { TimeControls } from "./TimeControls"

type ChartGranularity = "hourly" | "daily" | "weekly" | "monthly"

type ChartMetadata = {
  rangeStart?: string
  rangeEnd?: string
  windowLabel?: string
  bucketCount?: number
}

export type LayerMode = "type" | "model"

export type AreaBandKey = "input" | "output" | "cacheRead" | "cacheWrite" | string

export type AreaBand = {
  key: AreaBandKey
  label: string
  color: string
  value: (point: SeriesPoint) => number
}

function formatUsd(value: number | null | undefined, locale?: Intl.LocalesArgument) {
  if (value == null) {
    return "--"
  }

  const fractionDigits = value === 0 ? 2 : value >= 100 ? 0 : value >= 1 ? 2 : 4

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export function formatBucketLabel(point: SeriesPoint, granularity: ChartGranularity, locale?: Intl.LocalesArgument, showYear = false) {
  const date = new Date(point.bucketStart)
  if (Number.isNaN(date.getTime())) {
    return point.bucketStart
  }

  switch (granularity) {
    case "hourly":
      return new Intl.DateTimeFormat(locale, {
        timeZone: "UTC",
        year: showYear ? "numeric" : undefined,
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date)
    case "monthly":
      return new Intl.DateTimeFormat(locale, {
        timeZone: "UTC",
        year: "numeric",
        month: "short",
      }).format(date)
    case "weekly":
    case "daily":
      return new Intl.DateTimeFormat(locale, {
        timeZone: "UTC",
        year: showYear ? "numeric" : undefined,
        month: "short",
        day: "numeric",
      }).format(date)
  }
}

function formatRangeIsoDate(value: string | undefined) {
  return value?.slice(0, 10) ?? "--"
}

function isUnixEpochRangeStart(value: string | undefined) {
  return value === "1970-01-01T00:00:00.000Z" || value === "1970-01-01"
}

function isChineseLocale(locale?: Intl.LocalesArgument) {
  return typeof locale === "string" && locale.startsWith("zh")
}

function granularityLabel(granularity: ChartGranularity, locale?: Intl.LocalesArgument) {
  if (isChineseLocale(locale)) {
    return {
      hourly: "每小时",
      daily: "每日",
      weekly: "每周",
      monthly: "每月",
    }[granularity]
  }

  return granularity.slice(0, 1).toUpperCase() + granularity.slice(1)
}

function buildPolyline(points: Array<{ x: number; y: number }>) {
  return points.map((point) => `${point.x},${point.y}`).join(" ")
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function buildXAxisTickIndices(pointCount: number) {
  if (pointCount <= 0) {
    return []
  }

  const maxTickCount = pointCount > 5 ? 5 : Math.min(3, pointCount)
  const indices = new Set<number>()
  for (let tick = 0; tick < maxTickCount; tick += 1) {
    const ratio = maxTickCount === 1 ? 0 : tick / (maxTickCount - 1)
    indices.add(Math.round(ratio * (pointCount - 1)))
  }

  return Array.from(indices).sort((a, b) => a - b)
}

function buildXAxisTicks(
  pointCount: number,
  xForIndex: (index: number) => number,
  plot: { left: number; right: number },
) {
  const minSpacing = 72
  const estimatedLabelWidth = 64
  const candidateIndices = buildXAxisTickIndices(pointCount)
  const lastCandidateIndex = candidateIndices.at(-1)
  const labelXForPosition = (x: number, position: "first" | "middle" | "last") => {
    if (position === "first") {
      return clamp(x, plot.left, plot.right)
    }
    if (position === "last") {
      return clamp(x, plot.left, plot.right)
    }
    return clamp(x, plot.left + estimatedLabelWidth / 2, plot.right - estimatedLabelWidth / 2)
  }
  const lastCandidateX = lastCandidateIndex == null ? null : labelXForPosition(xForIndex(lastCandidateIndex), "last")
  const ticks: Array<{ index: number; x: number; textAnchor: "start" | "middle" | "end" }> = []

  for (const [candidatePosition, index] of candidateIndices.entries()) {
    const isFirstCandidate = candidatePosition === 0
    const isLastCandidate = index === lastCandidateIndex
    const position = isLastCandidate ? "last" : isFirstCandidate ? "first" : "middle"
    const x = labelXForPosition(xForIndex(index), position)
    const previousTick = ticks.at(-1)

    if (previousTick && x - previousTick.x < minSpacing) {
      continue
    }

    if (!isLastCandidate && lastCandidateX != null && lastCandidateX - x < minSpacing) {
      continue
    }

    ticks.push({
      index,
      x,
      textAnchor: position === "first" ? "start" : position === "last" ? "end" : "middle",
    })
  }

  return ticks
}

function getStatTotal(point: SeriesPoint, stat: DashboardStat) {
  if (stat === "cost") {
    return point.totalCostUsd ?? 0
  }

  return (point.inputTokens ?? 0)
    + (point.outputTokens ?? 0)
    + (point.reasoningTokens ?? 0)
    + (point.cacheReadTokens ?? 0)
    + (point.cacheWriteTokens ?? 0)
}

function hasAnyBucketActivity(point: SeriesPoint) {
  return (point.inputTokens ?? 0) > 0
    || (point.outputTokens ?? 0) > 0
    || (point.reasoningTokens ?? 0) > 0
    || (point.cacheReadTokens ?? 0) > 0
    || (point.cacheWriteTokens ?? 0) > 0
    || (point.totalCostUsd ?? 0) > 0
}

function getBucketTokenActivity(point: SeriesPoint) {
  return (point.inputTokens ?? 0)
    + (point.outputTokens ?? 0)
    + (point.reasoningTokens ?? 0)
    + (point.cacheReadTokens ?? 0)
    + (point.cacheWriteTokens ?? 0)
}

function getBucketActivityHeat(activity: number, maxActivity: number) {
  if (activity <= 0 || maxActivity <= 0) {
    return undefined
  }

  const normalized = clamp(activity / maxActivity, 0, 1)
  const scaled = (Math.exp(2.6 * normalized) - 1) / (Math.exp(2.6) - 1)
  const alpha = 0.025 + scaled * (0.42 - 0.025)

  return {
    activityLevel: Math.max(1, Math.ceil(scaled * 5)),
    activityAlpha: alpha,
  }
}

function formatStatValue(value: number, stat: DashboardStat, locale?: Intl.LocalesArgument) {
  if (stat === "cost") {
    return formatUsd(value, locale)
  }

  return new Intl.NumberFormat(locale, {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value)
}

function unitForStat(stat: DashboardStat, locale?: Intl.LocalesArgument) {
  if (stat === "cost") {
    return isChineseLocale(locale) ? "美元" : "USD"
  }

  return isChineseLocale(locale) ? "令牌" : "tokens"
}

function zeroValueNote(point: SeriesPoint, value: number, stat: DashboardStat, locale?: Intl.LocalesArgument) {
  if (value !== 0) {
    return ""
  }

  if (hasAnyBucketActivity(point)) {
    return isChineseLocale(locale) ? "当前统计为 0" : "0 selected stat"
  }

  return isChineseLocale(locale) ? "无活动" : "No activity"
}

function chartCopy(locale?: Intl.LocalesArgument) {
  if (isChineseLocale(locale)) {
    return {
      range: "范围",
      buckets: "个桶",
      unit: "单位",
      xAxis: "X 轴: 时间",
      yAxis: "Y 轴",
      details: "序列浏览器明细",
      showing: "显示",
      of: "/",
      noActiveSpikes: "暂无活动尖峰",
      noSpikeAlerts: "所选窗口未检测到尖峰告警。",
      unavailable: "不可用",
      modelShareUnavailable: "此数据窗口暂无模型占比拆分。",
      noOpenIssues: "暂无未解决问题",
      noPricingIssues: "当前未显示全历史定价问题。",
      firstSeen: "首次发现",
      lastSeen: "最后发现",
      reason: "原因",
      hint: "提示",
      expand: "展开",
      collapse: "收起",
    }
  }

  return {
    range: "Range",
    buckets: "buckets",
    unit: "Unit",
    xAxis: "X-axis: Time",
    yAxis: "Y-axis",
    details: "Series Explorer Details",
    showing: "Showing",
    of: "of",
    noActiveSpikes: "No active spikes",
    noSpikeAlerts: "No spike alerts detected for the selected window.",
    unavailable: "Unavailable",
    modelShareUnavailable: "Model-share breakdown is unavailable for this data window.",
    noOpenIssues: "No open issues",
    noPricingIssues: "No lifetime pricing issues are currently visible.",
    firstSeen: "First seen",
    lastSeen: "Last seen",
    reason: "Reason",
    hint: "Hint",
    expand: "Expand",
    collapse: "Collapse",
  }
}

function formatUnixTime(value: number | null | undefined, locale?: Intl.LocalesArgument) {
  return value == null ? chartCopy(locale).unavailable : new Date(value * 1000).toLocaleString(locale)
}

function formatPercent(value: number | null | undefined, locale?: Intl.LocalesArgument) {
  if (value == null || Number.isNaN(value)) {
    return isChineseLocale(locale) ? "未知" : "unknown"
  }

  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: value < 0.995 && value > 0 ? 1 : 0,
  }).format(value)
}

function sumStat(points: SeriesPoint[], stat: DashboardStat) {
  return points.reduce((sum, point) => sum + getStatTotal(point, stat), 0)
}

function buildSpikeDiagnostics(points: SeriesPoint[], stat: DashboardStat, granularity: ChartGranularity, locale?: Intl.LocalesArgument) {
  const values = points
    .map((point) => ({ point, value: getStatTotal(point, stat) }))
    .filter((entry) => entry.value > 0)
  const sortedValues = values.map((entry) => entry.value).sort((a, b) => a - b)
  const median = sortedValues.length === 0
    ? 0
    : sortedValues.length % 2 === 1
      ? sortedValues[Math.floor(sortedValues.length / 2)] ?? 0
      : ((sortedValues[sortedValues.length / 2 - 1] ?? 0) + (sortedValues[sortedValues.length / 2] ?? 0)) / 2
  const threshold = median > 0 ? median * 3 : Number.POSITIVE_INFINITY
  const spikes = values
    .filter((entry) => entry.value >= threshold && entry.value > median)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)

  if (isChineseLocale(locale)) {
    const copy = chartCopy(locale)
    return {
      count: spikes.length,
      summary: spikes.length > 0 ? `${spikes.length} 个尖峰` : copy.noActiveSpikes,
      description: spikes.length > 0
        ? `检测到 ${spikes.length} 个桶高于基线 ${formatStatValue(median, stat, locale)} 的 3 倍。`
        : `${points.length} 个桶中未发现高于基线 3 倍的${unitForStat(stat, locale)}尖峰。`,
      rows: spikes.map((entry) => `${formatBucketLabel(entry.point, granularity, locale, true)} · ${formatStatValue(entry.value, stat, locale)}`),
    }
  }

  return {
    count: spikes.length,
    summary: spikes.length > 0 ? `${spikes.length} ${spikes.length === 1 ? "spike" : "spikes"}` : chartCopy(locale).noActiveSpikes,
    description: spikes.length > 0
      ? `${spikes.length} buckets are above 3x the ${formatStatValue(median, stat, locale)} baseline.`
      : points.length === 0 ? "No buckets exceed the selected-stat baseline." : `${points.length} buckets do not exceed 3x the selected-stat baseline.`,
    rows: spikes.map((entry) => `${formatBucketLabel(entry.point, granularity, locale, true)} · ${formatStatValue(entry.value, stat, locale)}`),
  }
}

function addBucketDuration(start: Date, granularity: ChartGranularity) {
  const end = new Date(start)
  switch (granularity) {
    case "hourly":
      end.setUTCHours(end.getUTCHours() + 1)
      break
    case "daily":
      end.setUTCDate(end.getUTCDate() + 1)
      break
    case "weekly":
      end.setUTCDate(end.getUTCDate() + 7)
      break
    case "monthly":
      end.setUTCMonth(end.getUTCMonth() + 1)
      break
  }
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1)
  return end
}

function formatBucketRange(point: SeriesPoint, granularity: ChartGranularity, metadata: ChartMetadata | undefined) {
  const start = new Date(point.bucketStart)
  if (Number.isNaN(start.getTime())) {
    return point.bucketStart
  }

  const naturalEnd = addBucketDuration(start, granularity)
  const rangeStart = metadata?.rangeStart ? new Date(metadata.rangeStart) : null
  const rangeEnd = metadata?.rangeEnd ? new Date(metadata.rangeEnd) : null
  const clippedStart = rangeStart && !Number.isNaN(rangeStart.getTime()) && start.getTime() < rangeStart.getTime()
    ? rangeStart
    : start
  const end = rangeEnd && !Number.isNaN(rangeEnd.getTime()) && naturalEnd.getTime() > rangeEnd.getTime()
    ? rangeEnd
    : naturalEnd

  return `${clippedStart.toISOString()} → ${end.toISOString()}`
}

function bucketOverlapsRange(point: SeriesPoint, granularity: ChartGranularity, rangeStartMs: number, rangeEndMs: number) {
  const start = new Date(point.bucketStart)
  if (Number.isNaN(start.getTime())) {
    return true
  }

  const end = addBucketDuration(start, granularity)
  return end.getTime() >= rangeStartMs && start.getTime() <= rangeEndMs
}

function buildAreaBands(point: SeriesPoint, stat: DashboardStat): Array<{ key: AreaBandKey; value: number }> {
  if (stat === "cost") {
    return [
      { key: "input", value: point.inputCostUsd ?? 0 },
      { key: "output", value: (point.outputCostUsd ?? 0) + (point.reasoningCostUsd ?? 0) },
      { key: "cacheRead", value: point.cacheReadCostUsd ?? 0 },
      { key: "cacheWrite", value: point.cacheWriteCostUsd ?? 0 },
    ]
  }

  return [
    { key: "input", value: point.inputTokens ?? 0 },
    { key: "output", value: (point.outputTokens ?? 0) + (point.reasoningTokens ?? 0) },
    { key: "cacheRead", value: point.cacheReadTokens ?? 0 },
    { key: "cacheWrite", value: point.cacheWriteTokens ?? 0 },
  ]
}

export function MainSeriesChart(props: {
  points: SeriesPoint[]
  modelPoints?: SeriesModelBucket[]
  metadata?: ChartMetadata
  window?: DashboardWindow
  onWindowChange?: (value: DashboardWindow) => void
  selectedWindowSummary?: string
  granularity: ChartGranularity
  onGranularityChange?: (value: ChartGranularity) => void
  isLoading?: boolean
  loadingLabel?: string
  locale?: Intl.LocalesArgument
  stat: DashboardStat
  onStatChange: (stat: DashboardStat) => void
  layer: LayerMode
  onLayerChange: (layer: LayerMode) => void
  priceCoverage?: number
  pricingRecords?: Array<Pick<PricingRecordResponse, "enabled" | "canonicalModel">>
  pricingCoverageGaps?: PricingCoverageGap[]
  labels: {
    series: string
    chartTitle: string
    chartSubtitle: string
    noSeries: string
    statLabel: string
    cost: string
    tokens: string
    input: string
    outputInclReasoning: string
    cacheRead: string
    cacheWrite: string
    totalLabel: string
    selectedStat: string
    layerLabel: string
    layerUsageType: string
    layerModel: string
    others: string
    insightRail: string
    anomalyAlerts: string
    topModelShare: string
    pricingIssues: string
    controls?: {
      windowLabel: string
      selectedWindow: string
      customWindow: string
      startDate: string
      endDate: string
      invalidCustomWindow: string
      granularityLabel: string
      oneHour: string
      twentyFourHours: string
      sevenDaysShort: string
      thirtyDaysShort: string
      ninetyDaysShort: string
      allTime: string
      hourly: string
      daily: string
      weekly: string
      monthly: string
    }
  }
}) {
  const { points, granularity, locale, stat } = props
  const metadata = props.metadata
  const rangeStartMs = metadata?.rangeStart ? new Date(metadata.rangeStart).getTime() : Number.NEGATIVE_INFINITY
  const rangeEndMs = metadata?.rangeEnd ? new Date(metadata.rangeEnd).getTime() : Number.POSITIVE_INFINITY
  const chartPoints = [...points]
    .filter((point) => {
      return bucketOverlapsRange(point, granularity, rangeStartMs, rangeEndMs)
    })
    .sort((a, b) => new Date(a.bucketStart).getTime() - new Date(b.bucketStart).getTime())
  const displayMetadata = metadata?.windowLabel === "ALL" && isUnixEpochRangeStart(metadata.rangeStart) && chartPoints[0]?.bucketStart
    ? { ...metadata, rangeStart: chartPoints[0].bucketStart }
    : metadata
  const statOptions: Array<{ value: DashboardStat; label: string }> = [
    { value: "cost", label: props.labels.cost },
    { value: "tokens", label: props.labels.tokens },
  ]
  const statTotals = chartPoints.map((point) => getStatTotal(point, stat))
  const maxStatValue = Math.max(...statTotals, stat === "cost" ? 0.000001 : 1)
  const selectedStatLabel = statOptions.find((option) => option.value === stat)?.label ?? props.labels.selectedStat
  const windowLabel = metadata?.windowLabel ?? props.labels.chartSubtitle
  const displayWindowLabel = isChineseLocale(locale)
    ? ({ "24H": "24小时", "7D": "7天", "30D": "30天", "90D": "90天", ALL: "全部" }[windowLabel] ?? windowLabel)
    : windowLabel
  const copy = chartCopy(locale)
  const chartTitle = `${selectedStatLabel} · ${displayWindowLabel} · ${granularityLabel(granularity, locale)}`
  const unitLabel = unitForStat(stat, locale)
  const bucketCount = metadata?.bucketCount ?? chartPoints.length
  const rangeLabel = `${copy.range}: ${formatRangeIsoDate(displayMetadata?.rangeStart)} → ${formatRangeIsoDate(displayMetadata?.rangeEnd)}`
  const showYear = Boolean(displayMetadata?.rangeStart || displayMetadata?.rangeEnd)
  const yAxisTicks = [1, 2 / 3, 1 / 3, 0].map((ratio) => ratio * maxStatValue)
  const plot = { left: 56, right: 600, top: 24, bottom: 156 }
  const xRange = { left: plot.left, right: plot.right }
  const explicitRangeStartMs = displayMetadata?.rangeStart ? new Date(displayMetadata.rangeStart).getTime() : Number.NaN
  const explicitRangeEndMs = displayMetadata?.rangeEnd ? new Date(displayMetadata.rangeEnd).getTime() : Number.NaN
  const firstBucketStartMs = chartPoints[0]?.bucketStart ? new Date(chartPoints[0].bucketStart).getTime() : Number.NaN
  const lastBucketStartMs = chartPoints.at(-1)?.bucketStart ? new Date(chartPoints.at(-1)?.bucketStart ?? "").getTime() : Number.NaN
  const timeScaleStartMs = Number.isFinite(explicitRangeStartMs) ? explicitRangeStartMs : firstBucketStartMs
  const timeScaleEndMs = Number.isFinite(explicitRangeEndMs) ? explicitRangeEndMs : lastBucketStartMs
  const xForPoint = (point: SeriesPoint, index: number) => {
    const startMs = new Date(point.bucketStart).getTime()
    const bucketEndMs = addBucketDuration(new Date(point.bucketStart), granularity).getTime()
    const midpointMs = Number.isFinite(startMs) && Number.isFinite(bucketEndMs) ? (startMs + bucketEndMs) / 2 : Number.NaN
    const scaledMs = Number.isFinite(midpointMs) ? midpointMs : startMs

    if (!Number.isFinite(scaledMs) || !Number.isFinite(timeScaleStartMs) || !Number.isFinite(timeScaleEndMs) || timeScaleEndMs <= timeScaleStartMs) {
      return chartPoints.length === 1 ? (plot.left + plot.right) / 2 : xRange.left + ((index / (chartPoints.length - 1)) * (xRange.right - xRange.left))
    }

    const ratio = Math.min(1, Math.max(0, (scaledMs - timeScaleStartMs) / (timeScaleEndMs - timeScaleStartMs)))
    return xRange.left + (ratio * (xRange.right - xRange.left))
  }
  const yForValue = (value: number) => plot.bottom - ((value / maxStatValue) * (plot.bottom - plot.top))
  const footerPoints = chartPoints
  const spikeDiagnostics = buildSpikeDiagnostics(chartPoints, stat, granularity, locale)
  const selectedTotal = sumStat(chartPoints, stat)
  const tokenTotal = chartPoints.reduce((sum, point) => sum
    + getBucketTokenActivity(point), 0)
  const maxBucketTokenActivity = Math.max(0, ...chartPoints.map(getBucketTokenActivity))
  const activePricingRecords = (props.pricingRecords ?? []).filter((record) => record.enabled).length
  const coverage = props.priceCoverage
  const pricingGaps = props.pricingCoverageGaps ?? []
  const pricingIssueCount = pricingGaps.length > 0
    ? pricingGaps.length
    : (coverage != null && coverage < 0.999 ? 1 : 0) + (props.pricingRecords && activePricingRecords === 0 ? 1 : 0)
  const pricingSummary = props.pricingRecords?.length === 0
    ? pricingGaps.length > 0
      ? isChineseLocale(locale) ? `${pricingGaps.length} 个缺价模型` : `${pricingGaps.length} missing ${pricingGaps.length === 1 ? "model" : "models"}`
      : copy.noOpenIssues
    : isChineseLocale(locale)
      ? `覆盖 ${formatPercent(coverage, locale)} · ${pricingIssueCount} 个问题`
      : `Coverage ${formatPercent(coverage, locale)} · ${pricingIssueCount} ${pricingIssueCount === 1 ? "issue" : "issues"}`
  const pricingDescription = isChineseLocale(locale)
    ? pricingIssueCount > 0
      ? `全历史价格覆盖率为 ${formatPercent(coverage, locale)}，有 ${activePricingRecords} 条启用定价记录；请补齐缺失模型价格或刷新定价注册表。`
      : `全历史价格覆盖率为 ${formatPercent(coverage, locale)}，${activePricingRecords} 条启用定价记录可用于成本计算。`
    : pricingIssueCount > 0
      ? `Lifetime price coverage is ${formatPercent(coverage, locale)} with ${activePricingRecords} enabled pricing records; add missing model prices or refresh the registry.`
      : `Lifetime price coverage is ${formatPercent(coverage, locale)} with ${activePricingRecords} enabled pricing records available for costing.`
  const windowOverviewSummary = isChineseLocale(locale)
    ? `${chartPoints.length === 0 ? "空窗口" : `${chartPoints.length} 个桶`} · ${formatStatValue(selectedTotal, stat, locale)} ${unitLabel}`
    : `${chartPoints.length === 0 ? "Empty window" : `${chartPoints.length} buckets`} · ${formatStatValue(selectedTotal, stat, locale)} ${unitLabel}`
  const windowOverviewDescription = isChineseLocale(locale)
    ? `所选窗口包含 ${chartPoints.length} 个${granularityLabel(granularity, locale)}桶，累计 ${formatStatValue(selectedTotal, stat, locale)} ${unitLabel}，总令牌活动 ${new Intl.NumberFormat(locale).format(tokenTotal)}。`
    : `Selected window includes ${chartPoints.length} ${granularityLabel(granularity, locale).toLowerCase()} buckets totaling ${formatStatValue(selectedTotal, stat, locale)} ${unitLabel}, with ${new Intl.NumberFormat(locale).format(tokenTotal)} total token activity.`

  const loadingLabel = props.loadingLabel ?? (isChineseLocale(locale) ? "加载中" : "Loading")

  const MODEL_PALETTE = ["#f958aa", "#42b879", "#ff7437", "#910091", "#9bcd24", "#00b89c", "#ff5b43", "#4a87b9", "#d562d5", "#48a86e", "#e8a33d", "#6b7fd7", "#37b6a3", "#d14c6a", "#7a9e3f", "#b8860b", "#5f9ea0", "#cd5c5c", "#4682b4", "#d2691e"]
  const OTHERS_COLOR = "#8a94a6"
  const BIN_TOP_MODEL_COUNT = 8
  const MODEL_POOL_LIMIT = 20
  const layer = props.layer
  const modelBucketMap = new Map<string, SeriesModelBucket>()
  for (const bucket of props.modelPoints ?? []) {
    modelBucketMap.set(bucket.bucketStart, bucket)
  }
  const modelStatValue = (model: { totalTokens: number; totalCostUsd: number | null }) => stat === "cost" ? (model.totalCostUsd ?? 0) : model.totalTokens
  const modelTokenTotals = new Map<string, number>()
  for (const point of chartPoints) {
    const bucket = modelBucketMap.get(point.bucketStart)
    if (!bucket) {
      continue
    }
    for (const model of bucket.models) {
      modelTokenTotals.set(model.modelId, (modelTokenTotals.get(model.modelId) ?? 0) + model.totalTokens)
    }
  }
  // Global stable color pool: models ranked by window token volume keep a fixed
  // color across all buckets so a model is traceable over time. The genuine
  // long tail beyond the pool limit stays inside "Others" everywhere.
  const globalModelIds = [...modelTokenTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MODEL_POOL_LIMIT)
    .map(([modelId]) => modelId)
  // Per-bucket dynamic composition: each bucket shows its own top-N models by
  // token share (so deepseek appears in the last two days of a 90-day window
  // even though gpt-5.4/5.5 dominate the window total). Models not selected
  // for a given bucket fall into that bucket's "Others".
  const selectedByBucket = new Map<string, string[]>()
  for (const point of chartPoints) {
    const bucket = modelBucketMap.get(point.bucketStart)
    if (!bucket) {
      continue
    }
    const ranked = bucket.models
      .filter((model) => globalModelIds.includes(model.modelId))
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, BIN_TOP_MODEL_COUNT)
      .map((model) => model.modelId)
    selectedByBucket.set(point.bucketStart, ranked)
  }
  const bandModelIds = layer === "model" ? globalModelIds : []
  const bands: AreaBand[] = layer === "model" && bandModelIds.length > 0
    ? [
        ...bandModelIds.map((modelId, index) => ({
          key: `model:${modelId}`,
          label: modelId,
          color: MODEL_PALETTE[index % MODEL_PALETTE.length] ?? OTHERS_COLOR,
          value: (point: SeriesPoint) => {
            if (!selectedByBucket.get(point.bucketStart)?.includes(modelId)) {
              return 0
            }
            const bucket = modelBucketMap.get(point.bucketStart)
            const model = bucket?.models.find((candidate) => candidate.modelId === modelId)
            return model ? modelStatValue(model) : 0
          },
        })),
        {
          key: "model:others",
          label: props.labels.others,
          color: OTHERS_COLOR,
          value: (point: SeriesPoint) => {
            const bucket = modelBucketMap.get(point.bucketStart)
            const selected = selectedByBucket.get(point.bucketStart) ?? []
            const selectedSum = selected.reduce((sum, modelId) => {
              const model = bucket?.models.find((candidate) => candidate.modelId === modelId)
              return sum + (model ? modelStatValue(model) : 0)
            }, 0)
            return Math.max(0, getStatTotal(point, stat) - selectedSum)
          },
        },
      ]
    : [
        { key: "input", label: props.labels.input, color: "#4a87b9", value: (point: SeriesPoint) => buildAreaBands(point, stat)[0]?.value ?? 0 },
        { key: "output", label: props.labels.outputInclReasoning, color: "#f958aa", value: (point: SeriesPoint) => buildAreaBands(point, stat)[1]?.value ?? 0 },
        { key: "cacheRead", label: props.labels.cacheRead, color: "#42b879", value: (point: SeriesPoint) => buildAreaBands(point, stat)[2]?.value ?? 0 },
        { key: "cacheWrite", label: props.labels.cacheWrite, color: "#ff7437", value: (point: SeriesPoint) => buildAreaBands(point, stat)[3]?.value ?? 0 },
      ]

  const bandCumulative = chartPoints.map((point) => {
    const cumulative: number[] = []
    let running = 0
    for (const band of bands) {
      running += band.value(point)
      cumulative.push(running)
    }
    return cumulative
  })

  const bandPaths = bands.map((band, bandIndex) => {
    const topEdge = chartPoints.map((point, index) => {
      const cumulative = bandCumulative[index] ?? []
      return `${xForPoint(point, index)},${yForValue(cumulative[bandIndex] ?? 0)}`
    })
    const bottomEdge = chartPoints.map((point, index) => {
      const cumulative = bandCumulative[index] ?? []
      const previous = bandIndex === 0 ? 0 : (cumulative[bandIndex - 1] ?? 0)
      return `${xForPoint(point, index)},${yForValue(previous)}`
    }).reverse()

    return {
      band,
      path: `M ${topEdge.join(" L ")} L ${bottomEdge.join(" L ")} Z`,
    }
  })

  const totalOutline = buildPolyline(chartPoints.map((point, index) => {
    const cumulative = bandCumulative[index] ?? []
    return {
      x: xForPoint(point, index),
      y: yForValue(cumulative.at(-1) ?? 0),
    }
  }))

  const xAxisTicks = buildXAxisTicks(chartPoints.length, (index) => {
    const point = chartPoints[index]
    return point ? xForPoint(point, index) : plot.left
  }, plot)

  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const hoveredPoint = hoverIndex == null ? null : chartPoints[hoverIndex]
  // Dynamic legend: in model mode the legend reflects the composition of the
  // reference bucket (the hovered one, or the newest bucket when not hovering),
  // so models that are zero in that bucket are not listed at all.
  const legendReferencePoint = hoveredPoint ?? chartPoints.at(-1) ?? null
  const legendBands = layer === "model" && legendReferencePoint
    ? bands.filter((band) => band.value(legendReferencePoint) > 0)
    : bands
  const hoveredBands = hoveredPoint
    ? (layer === "model"
        ? bands.filter((band) => band.value(hoveredPoint) > 0)
        : bands)
        .map((band) => ({ key: band.key, label: band.label, color: band.color, value: band.value(hoveredPoint) }))
    : []
  const hoveredTotal = hoveredPoint ? getStatTotal(hoveredPoint, stat) : 0

  function handleChartMouseMove(event: React.MouseEvent<SVGSVGElement>) {
    if (chartPoints.length === 0) {
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - bounds.left) / bounds.width
    const chartX = ratio * 600
    let nearestIndex = 0
    let nearestDistance = Number.POSITIVE_INFINITY

    for (let index = 0; index < chartPoints.length; index += 1) {
      const point = chartPoints[index]
      if (!point) {
        continue
      }
      const distance = Math.abs(xForPoint(point, index) - chartX)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    }

    setHoverIndex(nearestIndex)
  }

  function tooltipLeftPercent() {
    if (hoverIndex == null) {
      return 0
    }
    const point = chartPoints[hoverIndex]
    if (!point) {
      return 0
    }
    const x = xForPoint(point, hoverIndex)
    return clamp((x / 600) * 100, 12, 62)
  }

  return (
    <section className="chart-panel" aria-label={props.labels.chartTitle} aria-busy={props.isLoading || undefined}>
      <header className="chart-panel__header">
        <div>
          <p className="chart-panel__eyebrow">{props.labels.series}</p>
          <h2>{props.isLoading && props.selectedWindowSummary ? `${selectedStatLabel} · ${props.selectedWindowSummary}` : chartTitle}</h2>
        </div>
        <p className="chart-panel__subtitle">{rangeLabel} · {bucketCount} {copy.buckets} · {copy.unit}: {unitLabel}</p>
      </header>

      {props.window && props.onWindowChange && props.onGranularityChange && props.labels.controls ? (
        <div className="chart-panel__toolbar">
          <TimeControls
            window={props.window}
            granularity={granularity}
            selectedWindowSummary={props.selectedWindowSummary ?? chartTitle}
            onWindowChange={props.onWindowChange}
            onGranularityChange={props.onGranularityChange}
            labels={props.labels.controls}
          />
        </div>
      ) : null}

      <div className="chart-panel__metric-row">
        <span className="control-group__title">{props.labels.statLabel}</span>
        <div className="control-group__buttons">
          {statOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`pill-button${stat === option.value ? " pill-button--active" : ""}`}
              aria-pressed={stat === option.value}
              onClick={() => props.onStatChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-panel__metric-row chart-panel__metric-row--layer">
        <span className="control-group__title">{props.labels.layerLabel}</span>
        <div className="control-group__buttons">
          {([
            ["type", props.labels.layerUsageType],
            ["model", props.labels.layerModel],
          ] as Array<[LayerMode, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`pill-button${layer === value ? " pill-button--active" : ""}`}
              aria-pressed={layer === value}
              onClick={() => props.onLayerChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-panel__layout">
        <div>
          {props.isLoading ? (
            <div className="chart-frame chart-frame--empty" role="status" aria-live="polite">
              <div className="chart-panel__empty">{loadingLabel}</div>
            </div>
          ) : chartPoints.length === 0 ? (
            <div className="chart-frame chart-frame--empty">
              <div className="chart-panel__legend">
                {legendBands.map((band) => (
                  <span key={band.key}><i className="legend-swatch" style={{ background: band.color }} />{band.label}</span>
                ))}
                <span className="chart-panel__axis-label">{copy.xAxis}</span>
                <span className="chart-panel__axis-label">{`${copy.yAxis}: ${unitLabel}`}</span>
              </div>
              <svg viewBox="0 0 600 180" className="chart-svg" role="img" aria-label={`${props.labels.noSeries}. ${rangeLabel}. ${copy.yAxis}: ${unitLabel}. ${copy.xAxis}.`}>
                <desc>{`${props.labels.noSeries}. ${rangeLabel}. ${copy.yAxis}: ${unitLabel}. ${copy.xAxis}.`}</desc>
                {[0, 1, 2, 3].map((line) => (
                  <g key={line}>
                    <line x1="56" x2="600" y1={24 + line * 40} y2={24 + line * 40} className="chart-grid-line" />
                    <text x="48" y={28 + line * 40} textAnchor="end" className="chart-y-tick-label">
                      {formatStatValue(0, stat, locale)}
                    </text>
                  </g>
                ))}
              </svg>
              <div className="chart-panel__empty">{props.labels.noSeries}</div>
            </div>
          ) : (
            <>
              <div className="chart-panel__legend">
                {legendBands.map((band) => (
                  <span key={band.key}><i className="legend-swatch" style={{ background: band.color }} />{band.label}</span>
                ))}
                <span className="chart-panel__axis-label">{copy.xAxis}</span>
                <span className="chart-panel__axis-label">{`${copy.yAxis}: ${unitLabel}`}</span>
              </div>

              <div className="chart-frame chart-frame--interactive">
                <div className="chart-tooltip-anchor">
                  {hoveredPoint ? (
                    <div className="chart-tooltip" style={{ left: `${tooltipLeftPercent()}%` }} role="status" aria-live="polite">
                      <div className="chart-tooltip__date">{formatBucketLabel(hoveredPoint, granularity, locale, showYear)}</div>
                      <div className="chart-tooltip__rows">
                        {hoveredBands.map((band) => (
                          <div key={band.key} className="chart-tooltip__row">
                            <i className="legend-swatch" style={{ background: band.color }} />
                            <span>{band.label}</span>
                            <strong>{formatStatValue(band.value, stat, locale)}</strong>
                          </div>
                        ))}
                      </div>
                      <div className="chart-tooltip__total">
                        <span>{props.labels.totalLabel}</span>
                        <strong>{formatStatValue(hoveredTotal, stat, locale)}</strong>
                      </div>
                    </div>
                  ) : null}
                  <svg
                    viewBox="0 0 600 180"
                    className="chart-svg"
                    role="img"
                    aria-label={`${chartTitle}. ${rangeLabel}. ${copy.yAxis}: ${unitLabel}. ${copy.xAxis}.`}
                    onMouseMove={handleChartMouseMove}
                    onMouseLeave={() => setHoverIndex(null)}
                  >
                    <desc>{`${chartTitle}. ${rangeLabel}. ${copy.yAxis}: ${unitLabel}. ${copy.xAxis}.`}</desc>
                    {[0, 1, 2, 3].map((line) => (
                      <g key={line}>
                        <line
                          x1="56"
                          x2="600"
                          y1={24 + line * 40}
                          y2={24 + line * 40}
                          className="chart-grid-line"
                        />
                        <text x="48" y={28 + line * 40} textAnchor="end" className="chart-y-tick-label">
                          {formatStatValue(yAxisTicks[line] ?? 0, stat, locale)}
                        </text>
                      </g>
                    ))}
                    {bandPaths.map(({ band, path }) => (
                      <path
                        key={band.key}
                        d={path}
                        className="chart-area-band"
                        style={{ fill: band.color }}
                      >
                        <title>{`${band.label} · ${formatStatValue(sumStat(chartPoints, stat), stat, locale)}`}</title>
                      </path>
                    ))}
                    <polyline className="chart-area-outline" fill="none" points={totalOutline} />
                    <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} className="chart-x-axis-line" />
                    {xAxisTicks.map((tick) => {
                      const point = chartPoints[tick.index]
                      if (!point) {
                        return null
                      }
                      return (
                        <g key={`x-tick-${point.bucketStart}`}>
                          <line x1={tick.x} x2={tick.x} y1={plot.bottom} y2={plot.bottom + 5} className="chart-x-axis-line" />
                          <text
                            x={tick.x}
                            y={plot.bottom + 18}
                            textAnchor={tick.textAnchor}
                            className={`chart-x-tick-label${tick.textAnchor === "middle" ? " chart-x-tick-label--optional" : ""}`}
                          >
                            {formatBucketLabel(point, granularity, locale, showYear)}
                          </text>
                        </g>
                      )
                    })}
                  </svg>
                </div>

                <CollapsiblePanel
                  title={copy.details}
                  summary={`${footerPoints.length} ${copy.of} ${chartPoints.length} ${copy.buckets}`}
                  defaultOpen
                  className="chart-details-panel"
                  labels={{ expand: copy.expand, collapse: copy.collapse }}
                >
                  <div className="chart-footer chart-footer--scroll-window" role="region" tabIndex={0} aria-label="Series Explorer details">
                    {footerPoints.map((point) => {
                      const value = getStatTotal(point, stat)
                      const zeroNote = zeroValueNote(point, value, stat, locale)
                      const bucketTokenActivity = getBucketTokenActivity(point)
                      const activityHeat = getBucketActivityHeat(bucketTokenActivity, maxBucketTokenActivity)
                      return (
                        <div
                          key={point.bucketStart}
                          className={`chart-footer__point${value === 0 ? " chart-footer__point--zero" : ""}`}
                          data-activity-level={activityHeat?.activityLevel}
                          style={activityHeat == null ? undefined : { backgroundColor: `rgba(124, 224, 255, ${activityHeat.activityAlpha})` }}
                          aria-label={`${formatBucketRange(point, granularity, displayMetadata)} · ${formatStatValue(value, stat, locale)}${zeroNote ? ` · ${zeroNote}` : ""}`}
                        >
                          <span data-testid="chart-bucket-label">{formatBucketLabel(point, granularity, locale, showYear)}</span>
                          <strong>{formatStatValue(value, stat, locale)}</strong>
                          {zeroNote ? <small>{zeroNote}</small> : null}
                        </div>
                      )
                    })}
                  </div>
                </CollapsiblePanel>
              </div>
            </>
          )}
        </div>

        <aside className="insight-rail" aria-label={props.labels.insightRail}>
          {props.isLoading ? (
            <div className="status-panel__block">
              <span className="status-panel__label">{props.labels.insightRail}</span>
              <strong>{loadingLabel}</strong>
            </div>
          ) : <>
          <CollapsiblePanel title={props.labels.anomalyAlerts} summary={spikeDiagnostics.summary} defaultOpen className="status-panel__block" labels={{ expand: copy.expand, collapse: copy.collapse }}>
            <p className="hero-card__caption">{spikeDiagnostics.description}</p>
            {spikeDiagnostics.rows.length > 0 ? (
              <ul className="status-panel__list" aria-label={isChineseLocale(locale) ? "尖峰桶" : "Spike buckets"}>
                {spikeDiagnostics.rows.map((row) => <li key={row}>{row}</li>)}
              </ul>
            ) : null}
          </CollapsiblePanel>
          <CollapsiblePanel title={props.labels.topModelShare} summary={windowOverviewSummary} defaultOpen className="status-panel__block" labels={{ expand: copy.expand, collapse: copy.collapse }}>
            <p className="hero-card__caption">{windowOverviewDescription}</p>
          </CollapsiblePanel>
          <CollapsiblePanel title={props.labels.pricingIssues} summary={pricingSummary} defaultOpen className="status-panel__block" labels={{ expand: copy.expand, collapse: copy.collapse }}>
            <p className="hero-card__caption">{pricingDescription}</p>
            {pricingGaps.length > 0 ? (
              <ul className="status-panel__list" aria-label={isChineseLocale(locale) ? "缺价模型" : "Missing pricing models"}>
                {pricingGaps.map((gap) => (
                  <li key={`${gap.providerId}/${gap.modelId}`}>
                    <strong>{gap.providerId} / {gap.modelId}</strong>
                    <span>{new Intl.NumberFormat(locale).format(gap.totalTokens)} {isChineseLocale(locale) ? "令牌" : "tokens"} · {new Intl.NumberFormat(locale).format(gap.messageCount)} {isChineseLocale(locale) ? "条消息" : "messages"}</span>
                    <dl className="status-panel__meta">
                      <div><dt>{copy.firstSeen}</dt><dd>{formatUnixTime(gap.firstSeen, locale)}</dd></div>
                      <div><dt>{copy.lastSeen}</dt><dd>{formatUnixTime(gap.lastSeen, locale)}</dd></div>
                      <div><dt>{copy.reason}</dt><dd>{gap.reason}</dd></div>
                      <div><dt>{copy.hint}</dt><dd>{isChineseLocale(locale) && gap.reason === "no_matching_pricing_record" ? `为 ${gap.providerId} / ${gap.modelId} 添加启用且 source URL 有效的定价记录。` : gap.hint}</dd></div>
                    </dl>
                  </li>
                ))}
              </ul>
            ) : null}
          </CollapsiblePanel>
          </>}
        </aside>
      </div>
    </section>
  )
}
