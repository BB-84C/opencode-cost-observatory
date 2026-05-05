import { useEffect, useId, useState } from "react"

import type { SeriesGranularity, SeriesMetric } from "../api/client"
import type { DashboardWindow } from "../hooks/useDashboardState"
import { isValidCustomWindow, type PresetWindow } from "../lib/windowSelection"

type Option<T extends string> = {
  value: T
  label: string
  disabled?: boolean
}

function ControlGroup<T extends string>(props: {
  title: string
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
}) {
  return (
    <div className="control-group">
      <span className="control-group__title">{props.title}</span>
      <div className="control-group__buttons">
        {props.options.map((option) => {
          const active = props.value === option.value
          return (
            <button
              key={option.value}
              aria-pressed={active}
              className={`pill-button${active ? " pill-button--active" : ""}`}
              type="button"
              disabled={option.disabled}
              onClick={() => props.onChange(option.value)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function TimeControls(props: {
  window: DashboardWindow
  granularity: SeriesGranularity
  metric: SeriesMetric
  ariaLabel?: string
  selectedWindowSummary: string
  onWindowChange: (value: DashboardWindow) => void
  onGranularityChange: (value: SeriesGranularity) => void
  onMetricChange: (value: SeriesMetric) => void
  labels: {
    windowLabel: string
    selectedWindow: string
    customWindow: string
    startDate: string
    endDate: string
    invalidCustomWindow: string
    granularityLabel: string
    metricLabel: string
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
    cost: string
    input: string
    output: string
    reasoning: string
    cacheRead: string
  }
}) {
  const customErrorId = useId()
  const [draftStart, setDraftStart] = useState(props.window.mode === "custom" ? props.window.start : "")
  const [draftEnd, setDraftEnd] = useState(props.window.mode === "custom" ? props.window.end : "")

  useEffect(() => {
    if (props.window.mode === "custom") {
      setDraftStart(props.window.start)
      setDraftEnd(props.window.end)
      return
    }

    setDraftStart("")
    setDraftEnd("")
  }, [props.window])

  function selectPreset(preset: PresetWindow) {
    setDraftStart("")
    setDraftEnd("")
    props.onWindowChange({ mode: "preset", preset })
  }

  function maybeApplyCustom(nextStart: string, nextEnd: string) {
    if (!isValidCustomWindow(nextStart, nextEnd)) {
      return
    }

    props.onWindowChange({ mode: "custom", start: nextStart, end: nextEnd })
  }

  function handleStartInput(nextStart: string) {
    setDraftStart(nextStart)
    maybeApplyCustom(nextStart, draftEnd)
  }

  function handleEndInput(nextEnd: string) {
    setDraftEnd(nextEnd)
    maybeApplyCustom(draftStart, nextEnd)
  }

  const activePreset = props.window.mode === "preset" ? props.window.preset : null
  const customInvalid = Boolean(draftStart && draftEnd && draftEnd < draftStart)
  const customErrorDescription = customInvalid ? customErrorId : undefined

  return (
    <section className="control-strip" aria-label={props.ariaLabel}>
      <div className="control-strip__topline">
        <div className="control-group">
          <span className="control-group__title">{props.labels.windowLabel}</span>
          <div className="control-group__buttons">
            {([
              ["24h", props.labels.twentyFourHours],
              ["7d", props.labels.sevenDaysShort],
              ["30d", props.labels.thirtyDaysShort],
              ["90d", props.labels.ninetyDaysShort],
              ["all", props.labels.allTime],
            ] as Array<[PresetWindow, string]>).map(([preset, label]) => (
              <button
                key={preset}
                aria-pressed={activePreset === preset}
                className={`pill-button${activePreset === preset ? " pill-button--active" : ""}`}
                type="button"
                onClick={() => selectPreset(preset)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={`control-group control-group--custom-window${props.window.mode === "preset" ? " control-group--inactive" : ""}`}>
          <span className="control-group__title">{props.labels.customWindow}</span>
          <div className="control-group__buttons">
            <label className="control-date-field">
              <span>{props.labels.startDate}</span>
              <input
                className="control-date-field__input"
                aria-label={props.labels.startDate}
                aria-describedby={customErrorDescription}
                aria-invalid={customInvalid || undefined}
                type="date"
                value={draftStart}
                onInput={(event) => handleStartInput(event.currentTarget.value)}
                onChange={(event) => handleStartInput(event.currentTarget.value)}
              />
            </label>
            <label className="control-date-field">
              <span>{props.labels.endDate}</span>
              <input
                className="control-date-field__input"
                aria-label={props.labels.endDate}
                aria-describedby={customErrorDescription}
                aria-invalid={customInvalid || undefined}
                type="date"
                value={draftEnd}
                onInput={(event) => handleEndInput(event.currentTarget.value)}
                onChange={(event) => handleEndInput(event.currentTarget.value)}
              />
            </label>
          </div>
          {customInvalid ? (
            <p id={customErrorId} className="control-group__error" role="alert" aria-live="polite">
              {props.labels.invalidCustomWindow}
            </p>
          ) : null}
        </div>

      </div>

      <div className="control-strip__bottomline">
        <ControlGroup
          title={props.labels.granularityLabel}
          value={props.granularity}
          onChange={props.onGranularityChange}
          options={[
            { value: "hourly", label: props.labels.hourly },
            { value: "daily", label: props.labels.daily },
            { value: "weekly", label: props.labels.weekly },
            { value: "monthly", label: props.labels.monthly },
          ]}
        />
      </div>
    </section>
  )
}
