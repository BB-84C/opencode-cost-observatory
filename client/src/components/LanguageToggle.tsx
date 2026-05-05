import type { DashboardLanguage } from "../hooks/useI18n"

export function LanguageToggle(props: { language: DashboardLanguage; label: string; onToggle: () => void }) {
  return (
    <button className="console-button console-button--ghost" type="button" onClick={props.onToggle} aria-label={props.label}>
      <strong>{props.label}</strong>
    </button>
  )
}
