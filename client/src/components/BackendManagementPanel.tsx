import { useState } from "react"
import { RefreshButton } from "./RefreshButton"
import { normalizeLocalhostAuthPayload, type BackendDiagnosticsResponse, type LocalhostAuthPayload, type RefreshResponse } from "../api/client"

function formatEpoch(value: number | null | undefined, locale: Intl.LocalesArgument) {
  if (value == null) {
    return null
  }

  return new Date(value * 1000).toLocaleString(locale, { timeZone: "UTC" })
}

function lifecycleFrom(diagnostics: BackendDiagnosticsResponse | null, updateStatus: RefreshResponse | null) {
  return diagnostics?.sync?.lifecycle ?? updateStatus?.lifecycle ?? (updateStatus?.status ? {
    status: updateStatus.status,
    requestedAt: updateStatus.requestedAt,
    startedAt: updateStatus.startedAt,
    completedAt: updateStatus.completedAt,
    sessionsSynced: updateStatus.sessionsSynced,
    messagesSynced: updateStatus.messagesSynced,
    durationMs: updateStatus.durationMs,
    error: updateStatus.error,
  } : null)
}

export function BackendManagementPanel(props: {
  ariaLabel: string
  backendHealthLabel: string
  authenticatedLabel: string
  unauthenticatedLabel: string
  isAuthenticated: boolean
  isBackendOnline: boolean
  isLoading: boolean
  isRefreshing: boolean
  status: string
  refreshLabel: string
  refreshingLabel: string
  onRefresh: () => void
  onAuthenticate: (payload: LocalhostAuthPayload) => void
  onStartBackend: () => void
  onRestartBackend: () => void
  onCheckBackend: () => void
  backendActionStatus?: null | "authenticating" | "authenticated" | "failed"
  backendControlStatus?: null | "checking" | "starting" | "restarting" | "started" | "restarted" | "failed"
  diagnostics: BackendDiagnosticsResponse | null
  updateStatus: RefreshResponse | null
  lagSummary: string
  locale: Intl.LocalesArgument
}) {
  const [token, setToken] = useState("")
  const [authFilePath, setAuthFilePath] = useState(".run/dashboard.token")
  const zh = typeof props.locale === "string" && props.locale.startsWith("zh")
  const visibleUpdateStatus = props.isBackendOnline ? props.updateStatus : null
  const lifecycle = lifecycleFrom(props.diagnostics, visibleUpdateStatus)
  const lastSuccessful = formatEpoch(props.diagnostics?.sync?.lastSuccessfulSyncTime ?? lifecycle?.lastSuccessfulSyncTime ?? props.diagnostics?.sync?.lastSyncTime, props.locale)
  const attemptTime = formatEpoch(lifecycle?.completedAt ?? lifecycle?.startedAt ?? lifecycle?.requestedAt ?? visibleUpdateStatus?.completedAt ?? visibleUpdateStatus?.requestedAt, props.locale)
  const updateDisabledReason = !props.isBackendOnline
    ? zh ? "后端离线；请先启动本地仪表盘服务再更新。" : "Backend is offline; start the local dashboard service before updating."
    : !props.isAuthenticated
      ? zh ? "请先使用本地仪表盘令牌登录，然后再更新。" : "Sign in with the local dashboard token before updating."
      : null
  const actionCopy = props.backendActionStatus === "authenticating"
    ? zh ? "正在连接本地仪表盘…" : "Connecting local dashboard…"
    : props.backendActionStatus === "failed"
      ? zh ? "本地令牌认证失败。" : "Local token authentication failed."
      : zh ? "使用 localhost 令牌文件认证此浏览器。" : "Uses the localhost token file to authenticate this browser."
  const lastSuccessfulLabel = zh ? "最后成功同步" : "Last successful sync"
  const lastAttemptLabel = zh ? "最后更新尝试" : "Last update attempt"
  const connectLabel = zh ? "连接本地仪表盘" : "Connect local dashboard"
  const tokenLabel = zh ? "仪表盘令牌" : "Dashboard token"
  const fileLabel = zh ? "令牌文件路径" : "Token file path"
  const localOnlyCopy = zh
    ? "仅限本机浏览器：通过 localhost 端点提交本地令牌或默认 .run/dashboard.token 文件。"
    : "Local browser only: submit a local token or the default .run/dashboard.token file through the localhost-only endpoint."
  const isControllingBackend = props.backendControlStatus === "checking" || props.backendControlStatus === "starting" || props.backendControlStatus === "restarting"
  const offlineControlCopy = props.backendControlStatus === "starting"
    ? zh ? "正在启动后端…" : "Starting backend…"
    : props.backendControlStatus === "restarting"
      ? zh ? "正在重启后端…" : "Restarting backend…"
      : props.backendControlStatus === "checking"
        ? zh ? "正在检查后端状态…" : "Checking backend status…"
        : props.backendControlStatus === "failed"
          ? zh ? "后端控制操作失败。" : "Backend control action failed."
          : props.backendControlStatus === "started" || props.backendControlStatus === "restarted"
            ? zh ? "后端控制命令已完成；如未连接，请使用本地令牌表单。" : "Backend control command completed; use the local token form if not connected."
            : zh ? "使用 Vite 本机控制端点启动或重启本地后端。" : "Use the Vite-local control endpoint to start or restart the backend."
  const startBackendLabel = zh ? "启动后端" : "Start Backend"
  const restartBackendLabel = zh ? "重启后端" : "Restart Backend"
  const retryStatusLabel = zh ? "重试状态" : "Retry Status"

  return (
    <section className="status-panel__block dashboard-header__status-card backend-sync-panel" aria-label={props.ariaLabel}>
      <span className="status-panel__label">{props.ariaLabel}</span>
      <strong>{props.backendHealthLabel} · {props.isAuthenticated ? props.authenticatedLabel : props.unauthenticatedLabel}</strong>
      <p className="hero-card__caption">{props.lagSummary}</p>
      {lastSuccessful ? <p className="hero-card__caption">{lastSuccessfulLabel}: {lastSuccessful}</p> : null}
      {attemptTime && lifecycle ? (
        <p className="hero-card__caption">{lastAttemptLabel}: {lifecycle.status} · {attemptTime}</p>
      ) : null}
      {lifecycle?.error ? <p className="hero-card__caption backend-sync-panel__error">{lifecycle.error}</p> : null}
      {updateDisabledReason ? <p className="hero-card__caption">{updateDisabledReason}</p> : null}
      {!props.isBackendOnline ? (
        <div className="backend-auth-panel">
          <p className="hero-card__caption">{offlineControlCopy}</p>
          <div className="refresh-cluster">
            <button type="button" className="console-button console-button--ghost" onClick={props.onStartBackend} disabled={isControllingBackend}>{startBackendLabel}</button>
            <button type="button" className="console-button console-button--ghost" onClick={props.onRestartBackend} disabled={isControllingBackend}>{restartBackendLabel}</button>
            <button type="button" className="console-button console-button--ghost" onClick={props.onCheckBackend} disabled={isControllingBackend}>{retryStatusLabel}</button>
          </div>
        </div>
      ) : null}
      {(!props.isAuthenticated || !props.isBackendOnline) ? (
        <div className="backend-auth-panel">
          <p className="hero-card__caption">{localOnlyCopy}</p>
          <label className="backend-auth-panel__field">
            <span>{tokenLabel}</span>
            <input value={token} onChange={(event) => setToken(event.currentTarget.value)} aria-label={tokenLabel} type="password" autoComplete="off" disabled={!props.isBackendOnline} />
          </label>
          <label className="backend-auth-panel__field">
            <span>{fileLabel}</span>
            <input value={authFilePath} onChange={(event) => setAuthFilePath(event.currentTarget.value)} aria-label={fileLabel} type="text" disabled={!props.isBackendOnline} />
          </label>
          <button
            type="button"
            className="console-button console-button--ghost"
            onClick={() => props.onAuthenticate(normalizeLocalhostAuthPayload({ token, authFilePath }))}
            disabled={!props.isBackendOnline || props.backendActionStatus === "authenticating"}
          >
            {connectLabel}
          </button>
          <p className="hero-card__caption">{actionCopy}</p>
        </div>
      ) : null}
      <RefreshButton
        label={props.refreshLabel}
        refreshingLabel={props.refreshingLabel}
        isRefreshing={props.isRefreshing}
        isLoading={props.isLoading}
        isAuthenticated={props.isAuthenticated}
        isBackendOnline={props.isBackendOnline}
        onRefresh={props.onRefresh}
        status={updateDisabledReason ?? props.status}
      />
    </section>
  )
}
