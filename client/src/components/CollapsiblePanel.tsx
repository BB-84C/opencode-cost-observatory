import { type KeyboardEvent, type ReactNode, useId, useState } from "react"

type CollapsiblePanelProps = {
  title: string
  summary?: ReactNode
  defaultOpen?: boolean
  scrollBody?: boolean
  children: ReactNode
  className?: string
  labels?: {
    expand: string
    collapse: string
  }
}

export function CollapsiblePanel({
  title,
  summary,
  defaultOpen = true,
  scrollBody = false,
  children,
  className,
  labels = { expand: "Expand", collapse: "Collapse" },
}: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const headingId = `${panelId}-heading`
  const bodyId = `${panelId}-body`

  function toggleOpen() {
    setOpen((value) => !value)
  }

  function handleHeaderKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      toggleOpen()
    }
  }

  return (
    <section className={["collapsible-panel", open ? "is-open" : "is-collapsed", className].filter(Boolean).join(" ")}>
      <h3 id={headingId} className="collapsible-panel__heading">
        <button
          className="collapsible-panel__header"
          type="button"
          onClick={toggleOpen}
          onKeyDown={handleHeaderKeyDown}
          aria-controls={bodyId}
          aria-expanded={open}
        >
          <span className="collapsible-panel__title">{title}</span>
          {summary ? <small className="collapsible-panel__summary">{summary}</small> : null}
          <strong className="collapsible-panel__toggle">{open ? labels.collapse : labels.expand}</strong>
        </button>
      </h3>
      {open ? (
        <div
          id={bodyId}
          className={["collapsible-panel__body", scrollBody ? "is-scrollable" : ""].filter(Boolean).join(" ")}
          role="region"
          aria-labelledby={headingId}
          tabIndex={scrollBody ? 0 : undefined}
        >
          {children}
        </div>
      ) : null}
    </section>
  )
}
