import { useState } from "react"

import type { CreatePricingRecordPayload, LeaderboardSession, PricingCoverageGap, PricingRecordResponse } from "../api/client"
import { CollapsiblePanel } from "./CollapsiblePanel"

function formatUsd(value: number | null, locale?: Intl.LocalesArgument) {
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

function formatEnum(value: string, locale?: Intl.LocalesArgument) {
  const zh = typeof locale === "string" && locale.startsWith("zh")
  const map: Record<string, [string, string]> = {
    manual: ["Manual", "手动"],
    official: ["Official", "官方"],
    openrouter: ["OpenRouter", "OpenRouter"],
    websearch: ["Web Search", "网页搜索"],
    per_token: ["Per Token", "逐令牌"],
    included_in_output: ["Included in Output", "并入输出"],
    stale: ["Stale", "过期"],
    active: ["Active", "有效"],
    disabled: ["Disabled", "已禁用"],
  }
  const item = map[value]
  return item ? item[zh ? 1 : 0] : value
}

function safeHttpUrl(value: string | null | undefined) {
  if (!value) {
    return null
  }

  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : null
  } catch {
    return null
  }
}

function pricingRecordIdPart(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized || "unknown"
}

function missingPricingRecordId(gap: PricingCoverageGap) {
  return `price-${pricingRecordIdPart(gap.providerId)}-${pricingRecordIdPart(gap.modelId)}-manual`
}

function localCopy(locale?: Intl.LocalesArgument) {
  const zh = typeof locale === "string" && locale.startsWith("zh")
  return zh
    ? {
        noSessions: "暂无会话",
        sessions: "个会话",
        tokens: "令牌",
        unavailable: "不可用",
        records: "条记录",
        gap: "缺口",
        firstSeen: "首次发现",
        lastSeen: "最后发现",
        reason: "原因",
        hint: "提示",
        noGaps: "暂无缺口",
        noSessionsAvailable: "暂无可用会话",
        pricingRecordsUnavailable: "定价记录不可用",
        current: "当前",
        freshnessUnavailable: "新鲜度不可用",
        noMissingPricing: "未检测到缺失定价",
        expand: "展开",
        collapse: "收起",
        models: "个模型",
        messages: "条消息",
      }
    : {
        noSessions: "No sessions",
        sessions: "sessions",
        tokens: "tokens",
        unavailable: "Unavailable",
        records: "records",
        gap: "gap",
        firstSeen: "First seen",
        lastSeen: "Last seen",
        reason: "Reason",
        hint: "Hint",
        noGaps: "No gaps",
        noSessionsAvailable: "No sessions available",
        pricingRecordsUnavailable: "Pricing records unavailable",
        current: "Current",
        freshnessUnavailable: "Freshness unavailable",
        noMissingPricing: "No missing pricing detected",
        expand: "Expand",
        collapse: "Collapse",
        models: "models",
        messages: "messages",
      }
}

export function LeaderboardTables(props: {
  costSessions?: LeaderboardSession[]
  tokenSessions?: LeaderboardSession[]
  pricingRecords?: PricingRecordResponse[]
  pricingCoverageGaps?: PricingCoverageGap[]
  points?: Array<{ inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; bucketStart: string }>
  locale?: Intl.LocalesArgument
  onArchivePricing?: (id: string) => void
  onMarkPricingManual?: (record: PricingRecordResponse) => void
  onSavePricing?: (record: PricingRecordResponse, patch: Partial<PricingRecordResponse>) => void
  onCreatePricing?: (payload: CreatePricingRecordPayload) => void
  priceCoverage?: number
  labels: {
    expensiveSessions: string
    tokenSessions: string
    pricingDrilldown: string
    windowBreakdown: string
    pricingFreshness: string
    title: string
    cost: string
    tokens: string
    source: string
    input: string
    output: string
    reasoning: string
    cacheRead: string
    edit: string
    missingPricing: string
    archive: string
    manual: string
    save: string
    cacheWrite: string
    confidence: string
    observed: string
    effective: string
    enabled: string
    superseded: string
    reasoningRule: string
    yes: string
    no: string
  }
}) {
  const [drafts, setDrafts] = useState<Record<string, { inputPrice: string; outputPrice: string; reasoningPrice: string; cacheReadPrice: string; cacheWritePrice: string; sourceUrl: string }>>({})
  const [gapDrafts, setGapDrafts] = useState<Record<string, { inputPrice: string; outputPrice: string; reasoningPrice: string; cacheReadPrice: string; cacheWritePrice: string; sourceUrl: string }>>({})
  const costSessions = props.costSessions ?? []
  const tokenSessions = props.tokenSessions ?? []
  const pricingRows = props.pricingRecords ?? []
  const editablePricingRows = pricingRows.filter((record) => record.enabled === true && record.supersededTime == null)
  const pricingCoverageGaps = props.pricingCoverageGaps ?? []
  const copy = localCopy(props.locale)
  const missingPricingSessions = costSessions.filter((session) => session.totalCostUsd == null)
  const missingPricingGap = props.priceCoverage == null ? 0 : Math.max(0, 1 - props.priceCoverage)
  const missingModelUnit = typeof props.locale === "string" && props.locale.startsWith("zh")
    ? copy.models
    : pricingCoverageGaps.length === 1 ? "model" : copy.models
  const costSummary = costSessions.length === 0 ? copy.noSessions : `${costSessions.length} ${copy.sessions} · ${formatUsd(costSessions.reduce((sum, session) => sum + (session.totalCostUsd ?? 0), 0), props.locale)}`
  const tokenSummary = tokenSessions.length === 0 ? copy.noSessions : `${tokenSessions.length} ${copy.sessions} · ${tokenSessions.reduce((sum, session) => sum + session.totalTokens, 0).toLocaleString(props.locale)} ${copy.tokens}`
  const pricingSummary = pricingRows.length === 0 ? copy.unavailable : `${pricingRows.length} ${copy.records}`
  const freshnessSummary = pricingRows.length === 0 ? copy.unavailable : `${pricingRows.length} ${copy.records} · ${Math.round(missingPricingGap * 100)}% ${copy.gap}`
  const missingSummary = pricingCoverageGaps.length > 0
    ? `${pricingCoverageGaps.length} ${missingModelUnit} · ${Math.round(missingPricingGap * 100)}% ${copy.gap}`
    : missingPricingSessions.length === 0 ? copy.noGaps : `${missingPricingSessions.length} ${copy.sessions} · ${Math.round(missingPricingGap * 100)}% ${copy.gap}`

  function getDraft(record: PricingRecordResponse) {
    return drafts[record.id] ?? {
      inputPrice: String(record.inputPrice),
      outputPrice: String(record.outputPrice),
      reasoningPrice: String(record.reasoningPrice),
      cacheReadPrice: String(record.cacheReadPrice),
      cacheWritePrice: String(record.cacheWritePrice),
      sourceUrl: record.sourceUrl ?? "",
    }
  }

  function pricingFieldLabel(record: PricingRecordResponse, field: string) {
    return `${field} for ${record.canonicalVendor} ${record.canonicalModel}`
  }

  function gapKey(gap: PricingCoverageGap) {
    return `${gap.providerId}/${gap.modelId}`
  }

  function getGapDraft(gap: PricingCoverageGap) {
    return gapDrafts[gapKey(gap)] ?? {
      inputPrice: "",
      outputPrice: "",
      reasoningPrice: "",
      cacheReadPrice: "",
      cacheWritePrice: "",
      sourceUrl: "",
    }
  }

  function missingPricingFieldLabel(gap: PricingCoverageGap, field: string) {
    return `${field} for missing ${gap.providerId} ${gap.modelId}`
  }

  function setGapDraftField(gap: PricingCoverageGap, field: "inputPrice" | "outputPrice" | "reasoningPrice" | "cacheReadPrice" | "cacheWritePrice" | "sourceUrl", value: string) {
    setGapDrafts((current) => {
      const key = gapKey(gap)
      return { ...current, [key]: { ...(current[key] ?? getGapDraft(gap)), [field]: value } }
    })
  }

  function submitGapPricing(gap: PricingCoverageGap) {
    const draft = getGapDraft(gap)
    if (![draft.inputPrice, draft.outputPrice, draft.reasoningPrice, draft.cacheReadPrice, draft.cacheWritePrice].every((value) => value.trim() !== "")) {
      return
    }

    const inputPrice = Number(draft.inputPrice)
    const outputPrice = Number(draft.outputPrice)
    const reasoningPrice = Number(draft.reasoningPrice)
    const cacheReadPrice = Number(draft.cacheReadPrice)
    const cacheWritePrice = Number(draft.cacheWritePrice)
    if (![inputPrice, outputPrice, reasoningPrice, cacheReadPrice, cacheWritePrice].every(Number.isFinite)) {
      return
    }

    const sourceUrl = draft.sourceUrl.trim()
    const safeSourceUrl = safeHttpUrl(sourceUrl)
    if (!safeSourceUrl) {
      return
    }

    props.onCreatePricing?.({
      id: missingPricingRecordId(gap),
      canonicalVendor: gap.providerId,
      canonicalModel: gap.modelId,
      vendorModelId: gap.modelId,
      currency: "USD",
      inputPrice,
      outputPrice,
      reasoningPrice,
      cacheReadPrice,
      cacheWritePrice,
      sourceType: "manual",
      sourceUrl: safeSourceUrl,
      confidence: "medium",
      isManualOverride: true,
      effectiveTime: gap.firstSeen,
      reasoningBillingRule: {
        kind: "per_token",
        provenance: {
          sourceType: "manual",
          sourceUrl: safeSourceUrl,
        },
      },
    })
  }

  function formatTime(value: number | null | undefined) {
    return value ? new Date(value * 1000).toLocaleString(props.locale) : copy.unavailable
  }

  return (
    <section className="leaderboard-grid" aria-label={props.labels.title}>
      <CollapsiblePanel title={props.labels.expensiveSessions} summary={costSummary} defaultOpen scrollBody className="leaderboard-panel" labels={{ expand: copy.expand, collapse: copy.collapse }}>
        <table>
          <tbody>
            {costSessions.length === 0 ? <tr><td colSpan={2}>{copy.noSessionsAvailable}</td></tr> : costSessions.slice(0, 5).map((session) => (
              <tr key={session.sessionId}>
                <td>{session.title}</td>
                <td>{formatUsd(session.totalCostUsd, props.locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsiblePanel>
      <CollapsiblePanel title={props.labels.tokenSessions} summary={tokenSummary} defaultOpen scrollBody className="leaderboard-panel" labels={{ expand: copy.expand, collapse: copy.collapse }}>
        <table>
          <tbody>
            {tokenSessions.length === 0 ? <tr><td colSpan={2}>{copy.noSessionsAvailable}</td></tr> : tokenSessions.slice(0, 5).map((session) => (
              <tr key={session.sessionId}>
                <td>{session.title}</td>
                <td>{session.totalTokens.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsiblePanel>
      <CollapsiblePanel title={props.labels.pricingDrilldown} summary={pricingSummary} defaultOpen scrollBody className="leaderboard-panel" labels={{ expand: copy.expand, collapse: copy.collapse }}>
        {editablePricingRows.length === 0 ? (
          <p className="pricing-card-empty">{copy.pricingRecordsUnavailable}</p>
        ) : (
          <div className="pricing-card-grid">
            {editablePricingRows.map((record) => {
              const draft = getDraft(record)
              const priceFields = [
                [props.labels.input, record.inputPrice],
                [props.labels.output, record.outputPrice],
                [props.labels.reasoning, record.reasoningPrice],
                [props.labels.cacheRead, record.cacheReadPrice],
                [props.labels.cacheWrite, record.cacheWritePrice],
              ] as const

              return (
                <article className="pricing-card" key={record.id} aria-label={`Pricing record for ${record.canonicalVendor} ${record.canonicalModel}`}>
                  <div className="pricing-card__header">
                    <div className="pricing-card__identity">
                      <strong className="pricing-card__model">{record.canonicalVendor} / {record.canonicalModel}</strong>
                      <span className="pricing-card__vendor-id">{record.vendorModelId}</span>
                    </div>
                    <div className="pricing-card__badges" aria-label={`${props.labels.source} and ${props.labels.confidence}`}>
                      <span>{formatEnum(record.sourceType, props.locale)}</span>
                      <span>{record.confidence}</span>
                    </div>
                  </div>

                  <div className="pricing-card__source">
                    <span>{props.labels.source}</span>
                    {safeHttpUrl(record.sourceUrl) ? <a href={safeHttpUrl(record.sourceUrl)!}>{record.sourceUrl}</a> : <span>{copy.unavailable}</span>}
                  </div>

                  <dl className="pricing-card__price-grid">
                    {priceFields.map(([label, value]) => (
                      <div className="pricing-card__price-chip" key={label}>
                        <dt>{label}</dt>
                        <dd>{formatUsd(value, props.locale)}</dd>
                      </div>
                    ))}
                  </dl>

                  <dl className="pricing-card__meta">
                    <div><dt>{props.labels.observed}</dt><dd>{formatTime(record.observedTime)}</dd></div>
                    <div><dt>{props.labels.effective}</dt><dd>{formatTime(record.effectiveTime)}</dd></div>
                    <div><dt>{props.labels.superseded}</dt><dd>{record.supersededTime ? formatTime(record.supersededTime) : copy.current}</dd></div>
                    <div><dt>{props.labels.manual}</dt><dd>{record.isManualOverride ? props.labels.yes : props.labels.no}</dd></div>
                    <div><dt>{props.labels.enabled}</dt><dd>{record.enabled ? props.labels.yes : props.labels.no}</dd></div>
                    <div><dt>{props.labels.reasoningRule}</dt><dd>{formatEnum(record.reasoningBillingRule.kind, props.locale)}</dd></div>
                  </dl>

                  <div className="pricing-card__edit-grid" aria-label={`${props.labels.edit}: ${record.canonicalVendor} ${record.canonicalModel}`}>
                    <label><span>{props.labels.input}</span><input className="control-placeholder__input" value={draft.inputPrice} onChange={(event) => setDrafts((current) => ({ ...current, [record.id]: { ...getDraft(record), inputPrice: event.target.value } }))} aria-label={pricingFieldLabel(record, "Input price")} /></label>
                    <label><span>{props.labels.output}</span><input className="control-placeholder__input" value={draft.outputPrice} onChange={(event) => setDrafts((current) => ({ ...current, [record.id]: { ...getDraft(record), outputPrice: event.target.value } }))} aria-label={pricingFieldLabel(record, "Output price")} /></label>
                    <label><span>{props.labels.reasoning}</span><input className="control-placeholder__input" value={draft.reasoningPrice} onChange={(event) => setDrafts((current) => ({ ...current, [record.id]: { ...getDraft(record), reasoningPrice: event.target.value } }))} aria-label={pricingFieldLabel(record, "Reasoning price")} /></label>
                    <label><span>{props.labels.cacheRead}</span><input className="control-placeholder__input" value={draft.cacheReadPrice} onChange={(event) => setDrafts((current) => ({ ...current, [record.id]: { ...getDraft(record), cacheReadPrice: event.target.value } }))} aria-label={pricingFieldLabel(record, "Cache read price")} /></label>
                    <label><span>{props.labels.cacheWrite}</span><input className="control-placeholder__input" value={draft.cacheWritePrice} onChange={(event) => setDrafts((current) => ({ ...current, [record.id]: { ...getDraft(record), cacheWritePrice: event.target.value } }))} aria-label={pricingFieldLabel(record, "Cache write price")} /></label>
                    <label className="pricing-card__source-edit"><span>{props.labels.source}</span><input className="control-placeholder__input" value={draft.sourceUrl} onChange={(event) => setDrafts((current) => ({ ...current, [record.id]: { ...getDraft(record), sourceUrl: event.target.value } }))} aria-label={pricingFieldLabel(record, "Source URL")} /></label>
                  </div>

                  <div className="pricing-card__actions">
                    <button type="button" className="pill-button" onClick={() => {
                      const latestDraft = getDraft(record)
                      if (![latestDraft.inputPrice, latestDraft.outputPrice, latestDraft.reasoningPrice, latestDraft.cacheReadPrice, latestDraft.cacheWritePrice].every((value) => value.trim() !== "")) {
                        return
                      }
                      const inputPrice = Number(latestDraft.inputPrice)
                      const outputPrice = Number(latestDraft.outputPrice)
                      const reasoningPrice = Number(latestDraft.reasoningPrice)
                      const cacheReadPrice = Number(latestDraft.cacheReadPrice)
                      const cacheWritePrice = Number(latestDraft.cacheWritePrice)
                      if (![inputPrice, outputPrice, reasoningPrice, cacheReadPrice, cacheWritePrice].every(Number.isFinite)) {
                        return
                      }
                      const sourceUrl = safeHttpUrl(latestDraft.sourceUrl.trim())
                      if (!sourceUrl) {
                        return
                      }
                      void props.onSavePricing?.(record, { inputPrice, outputPrice, reasoningPrice, cacheReadPrice, cacheWritePrice, sourceUrl })
                    }}>{props.labels.save}</button>
                    {record.enabled ? (
                      <>
                        <button type="button" className="pill-button" onClick={() => props.onMarkPricingManual?.(record)}>{props.labels.manual}</button>
                        <button type="button" className="pill-button" onClick={() => props.onArchivePricing?.(record.id)}>{props.labels.archive}</button>
                      </>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </CollapsiblePanel>
      <CollapsiblePanel title={props.labels.pricingFreshness} summary={freshnessSummary} defaultOpen scrollBody className="leaderboard-panel" labels={{ expand: copy.expand, collapse: copy.collapse }}>
        <table>
          <tbody>
            {pricingRows.length === 0 ? <tr><td colSpan={2}>{copy.freshnessUnavailable}</td></tr> : pricingRows.map((record) => (
              <tr key={`${record.id}-fresh`}>
                <td>{record.canonicalVendor} / {record.canonicalModel}</td>
                <td>{new Date((record.observedTime ?? record.effectiveTime) * 1000).toLocaleString(props.locale)}</td>
              </tr>
            ))}
            <tr>
              <td>{props.labels.missingPricing}</td>
              <td>{Math.round(missingPricingGap * 100)}%</td>
            </tr>
          </tbody>
        </table>
      </CollapsiblePanel>
      <CollapsiblePanel key={pricingCoverageGaps.length > 0 ? "missing-pricing-with-gaps" : "missing-pricing-no-gaps"} title={props.labels.missingPricing} summary={missingSummary} defaultOpen={pricingCoverageGaps.length > 0} className="leaderboard-panel" labels={{ expand: copy.expand, collapse: copy.collapse }}>
        <table>
          <tbody>
            {pricingCoverageGaps.length > 0 ? pricingCoverageGaps.map((gap) => {
              const draft = getGapDraft(gap)
              return (
                <tr key={`${gap.providerId}/${gap.modelId}-gap`}>
                  <td>{gap.providerId} / {gap.modelId}</td>
                  <td>
                    <div>{gap.totalTokens.toLocaleString(props.locale)} {copy.tokens} · {gap.messageCount.toLocaleString(props.locale)} {copy.messages}</div>
                    <dl className="pricing-gap-meta">
                      <div><dt>{copy.firstSeen}</dt><dd>{formatTime(gap.firstSeen)}</dd></div>
                      <div><dt>{copy.lastSeen}</dt><dd>{formatTime(gap.lastSeen)}</dd></div>
                      <div><dt>{copy.reason}</dt><dd>{gap.reason}</dd></div>
                      <div><dt>{copy.hint}</dt><dd>{gap.hint}</dd></div>
                    </dl>
                    <div className="pricing-card__edit-grid" aria-label={`${props.labels.missingPricing}: ${gap.providerId} ${gap.modelId}`}>
                      <label><span>{props.labels.input}</span><input className="control-placeholder__input" value={draft.inputPrice} onChange={(event) => setGapDraftField(gap, "inputPrice", event.target.value)} aria-label={missingPricingFieldLabel(gap, "Input price")} /></label>
                      <label><span>{props.labels.output}</span><input className="control-placeholder__input" value={draft.outputPrice} onChange={(event) => setGapDraftField(gap, "outputPrice", event.target.value)} aria-label={missingPricingFieldLabel(gap, "Output price")} /></label>
                      <label><span>{props.labels.reasoning}</span><input className="control-placeholder__input" value={draft.reasoningPrice} onChange={(event) => setGapDraftField(gap, "reasoningPrice", event.target.value)} aria-label={missingPricingFieldLabel(gap, "Reasoning price")} /></label>
                      <label><span>{props.labels.cacheRead}</span><input className="control-placeholder__input" value={draft.cacheReadPrice} onChange={(event) => setGapDraftField(gap, "cacheReadPrice", event.target.value)} aria-label={missingPricingFieldLabel(gap, "Cache read price")} /></label>
                      <label><span>{props.labels.cacheWrite}</span><input className="control-placeholder__input" value={draft.cacheWritePrice} onChange={(event) => setGapDraftField(gap, "cacheWritePrice", event.target.value)} aria-label={missingPricingFieldLabel(gap, "Cache write price")} /></label>
                      <label className="pricing-card__source-edit"><span>{props.labels.source}</span><input className="control-placeholder__input" value={draft.sourceUrl} onChange={(event) => setGapDraftField(gap, "sourceUrl", event.target.value)} aria-label={missingPricingFieldLabel(gap, "Source URL")} /></label>
                    </div>
                    <div className="pricing-card__actions">
                      <button type="button" className="pill-button" onClick={() => submitGapPricing(gap)} aria-label={`Create pricing for ${gap.providerId} ${gap.modelId}`}>{props.labels.save}</button>
                    </div>
                  </td>
                </tr>
              )
            }) : missingPricingSessions.length === 0 ? <tr><td colSpan={2}>{copy.noMissingPricing}</td></tr> : missingPricingSessions.map((session) => (
              <tr key={`${session.sessionId}-gap`}>
                <td>{session.title}</td>
                <td>{props.labels.missingPricing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsiblePanel>
    </section>
  )
}
