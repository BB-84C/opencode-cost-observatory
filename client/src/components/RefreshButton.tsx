export function RefreshButton(props: { label: string; refreshingLabel: string; isRefreshing: boolean; isLoading?: boolean; isAuthenticated?: boolean; isBackendOnline?: boolean; onRefresh: () => void; status: string }) {
  const disabled = props.isRefreshing || props.isLoading || props.isAuthenticated === false || props.isBackendOnline === false

  return (
    <div className="refresh-cluster">
      <button className="console-button console-button--accent" type="button" onClick={props.onRefresh} disabled={disabled}>
        {props.isRefreshing ? props.refreshingLabel : props.label}
      </button>
      <p className="refresh-cluster__status" role="status" aria-live="polite">{props.status}</p>
    </div>
  )
}
