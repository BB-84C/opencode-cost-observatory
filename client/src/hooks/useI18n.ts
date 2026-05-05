import { useMemo, useState } from "react"

export type DashboardLanguage = "en" | "zh"

type Dictionary = {
  eyebrow: string
  title: string
  subtitle: string
  series: string
  seriesQueryControls: string
  refresh: string
  refreshing: string
  switchLanguage: string
  secondsShort: string
  minutesShort: string
  hoursShort: string
  daysShort: string
  authSession: string
  backendDiagnostics: string
  backendOnline: string
  backendOffline: string
  analysisPanels: string
  loading: string
  attentionRequired: string
  windowSpend: string
  lifetimeSpend: string
  activeAlerts: string
  priceCoverage: string
  syncLag: string
  totalTokens: string
  chartTitle: string
  chartSubtitle: string
  noSeries: string
  cost: string
  tokens: string
  live: string
  authenticated: string
  unauthenticated: string
  healthy: string
  delayed: string
  unknown: string
  lag: string
  never: string
  windowLabel: string
  selectedWindow: string
  customWindow: string
  startDate: string
  endDate: string
  invalidCustomWindow: string
  compare: string
  filters: string
  model: string
  provider: string
  source: string
  cache: string
  search: string
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
  input: string
  output: string
  reasoning: string
  cacheRead: string
  thirtyDayWindow: string
  synced: string
  lastSync: string
  trendStrip: string
  insightRail: string
  latestBucket: string
  peakValue: string
  selectedMetric: string
  percentOfLifetime: string
  investigateSignals: string
  noWarnings: string
  anomalyAlerts: string
  topModelShare: string
  pricingIssues: string
  expensiveSessions: string
  tokenSessions: string
  pricingDrilldown: string
  activityHeatmap: string
  freshness: string
  activePricing: string
  cacheEfficiency: string
  effectiveCost: string
  pricingSources: string
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
  expand: string
  collapse: string
}

const DICTIONARY: Record<DashboardLanguage, Dictionary> = {
  en: {
    eyebrow: "Spend Command Center",
    title: "OpenCode Cost Observatory",
    subtitle: "Dense local telemetry for spend, token flow, and refresh health across your analytics store.",
    series: "Series",
    seriesQueryControls: "Series Explorer query controls",
    refresh: "Update",
    refreshing: "Updating…",
    switchLanguage: "Toggle Language",
    secondsShort: "s",
    minutesShort: "m",
    hoursShort: "h",
    daysShort: "d",
    authSession: "Auth Session",
    backendDiagnostics: "Backend Status & Diagnostics",
    backendOnline: "Backend Online",
    backendOffline: "Backend Offline",
    analysisPanels: "Leaderboards & Pricing",
    loading: "Loading",
    attentionRequired: "Attention Required",
    windowSpend: "Window Spend",
    lifetimeSpend: "Lifetime Spend",
    activeAlerts: "Active Alerts",
    priceCoverage: "Price Coverage",
    syncLag: "Sync Lag",
    totalTokens: "Lifetime Tokens",
    chartTitle: "Series Explorer",
    chartSubtitle: "Metric pivots, shell controls, and the insight rail are ready for deeper drilldowns.",
    noSeries: "No series points yet",
    cost: "Cost",
    tokens: "Tokens",
    live: "Live",
    authenticated: "Authenticated",
    unauthenticated: "Unauthenticated",
    healthy: "Healthy",
    delayed: "Delayed",
    unknown: "Unknown",
    lag: "lag",
    never: "Never synced",
    windowLabel: "Window",
    selectedWindow: "Selected Window",
    customWindow: "Custom Window",
    startDate: "Start date",
    endDate: "End date",
    invalidCustomWindow: "End date must be on or after start date",
    compare: "Compare",
    filters: "Filters",
    model: "Model",
    provider: "Provider",
    source: "Source",
    cache: "Cache",
    search: "Search",
    granularityLabel: "Granularity",
    metricLabel: "Metric",
    oneHour: "1H",
    twentyFourHours: "24H",
    sevenDaysShort: "7D",
    thirtyDaysShort: "30D",
    ninetyDaysShort: "90D",
    allTime: "ALL",
    hourly: "Hourly",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    input: "Input",
    output: "Output",
    reasoning: "Reasoning",
    cacheRead: "Cache Read",
    thirtyDayWindow: "30D cost window",
    synced: "Sync telemetry",
    lastSync: "Last Sync",
    trendStrip: "Trend Strip",
    insightRail: "Insight Rail",
    latestBucket: "Latest Bucket",
    peakValue: "Peak Value",
    selectedMetric: "Selected Metric",
    percentOfLifetime: "% of lifetime",
    investigateSignals: "Investigate degraded signals",
    noWarnings: "No active warnings",
    anomalyAlerts: "Spike Alerts",
    topModelShare: "Window Overview",
    pricingIssues: "Pricing Issues",
    expensiveSessions: "Most Expensive Sessions",
    tokenSessions: "Highest Token Sessions",
    pricingDrilldown: "Pricing Drilldown",
    activityHeatmap: "Activity Heatmap",
    freshness: "Freshness",
    activePricing: "Active Pricing",
    cacheEfficiency: "Cache Efficiency",
    effectiveCost: "Avg Cost / 1M Tokens",
    pricingSources: "Pricing Sources",
    edit: "Edit",
    missingPricing: "Missing Pricing",
    archive: "Archive",
    manual: "Manual",
    save: "Save",
    cacheWrite: "Cache Write",
    confidence: "Confidence",
    observed: "Observed",
    effective: "Effective",
    enabled: "Enabled",
    superseded: "Superseded",
    reasoningRule: "Reasoning Rule",
    yes: "Yes",
    no: "No",
    expand: "Expand",
    collapse: "Collapse",
  },
  zh: {
    eyebrow: "成本指挥台",
    title: "OpenCode 成本观测台",
    subtitle: "面向本地分析库的高密度成本、令牌流量与刷新健康度控制台。",
    series: "趋势图",
    seriesQueryControls: "序列浏览器查询控件",
    refresh: "更新",
    refreshing: "正在更新…",
    switchLanguage: "切换语言",
    secondsShort: "秒",
    minutesShort: "分",
    hoursShort: "时",
    daysShort: "天",
    authSession: "认证会话",
    backendDiagnostics: "后端状态与诊断",
    backendOnline: "后端在线",
    backendOffline: "后端离线",
    analysisPanels: "排行榜与定价",
    loading: "加载中",
    attentionRequired: "需要关注",
    windowSpend: "窗口成本",
    lifetimeSpend: "累计花费",
    activeAlerts: "告警",
    priceCoverage: "定价覆盖",
    syncLag: "同步延迟",
    totalTokens: "累计令牌",
    chartTitle: "序列浏览器",
    chartSubtitle: "指标切换、壳层控制与洞察侧栏已经就位，可继续扩展下钻能力。",
    noSeries: "暂时没有序列数据",
    cost: "成本",
    tokens: "令牌",
    live: "在线",
    authenticated: "已认证",
    unauthenticated: "未认证",
    healthy: "健康",
    delayed: "延迟",
    unknown: "未知",
    lag: "延迟",
    never: "尚未同步",
    windowLabel: "时间窗口",
    selectedWindow: "当前窗口",
    customWindow: "自定义窗口",
    startDate: "开始日期",
    endDate: "结束日期",
    invalidCustomWindow: "结束日期不能早于开始日期",
    compare: "对比",
    filters: "筛选",
    model: "模型",
    provider: "供应商",
    source: "来源",
    cache: "缓存",
    search: "搜索",
    granularityLabel: "粒度",
    metricLabel: "指标",
    oneHour: "1小时",
    twentyFourHours: "24小时",
    sevenDaysShort: "7天",
    thirtyDaysShort: "30天",
    ninetyDaysShort: "90天",
    allTime: "全部",
    hourly: "每小时",
    daily: "每日",
    weekly: "每周",
    monthly: "每月",
    input: "输入",
    output: "输出",
    reasoning: "推理",
    cacheRead: "缓存读取",
    thirtyDayWindow: "30 天成本窗口",
    synced: "同步遥测",
    lastSync: "最后同步",
    trendStrip: "趋势条",
    insightRail: "洞察侧栏",
    latestBucket: "最新桶",
    peakValue: "峰值",
    selectedMetric: "当前指标",
    percentOfLifetime: "占累计比例",
    investigateSignals: "需要排查降级信号",
    noWarnings: "当前无告警",
    anomalyAlerts: "尖峰告警",
    topModelShare: "窗口概览",
    pricingIssues: "定价问题",
    expensiveSessions: "最贵会话",
    tokenSessions: "最高令牌会话",
    pricingDrilldown: "定价下钻",
    activityHeatmap: "活动热力图",
    freshness: "新鲜度",
    activePricing: "有效定价",
    cacheEfficiency: "缓存效率",
    effectiveCost: "每百万令牌均价",
    pricingSources: "定价来源",
    edit: "编辑",
    missingPricing: "缺失定价",
    archive: "归档",
    manual: "手动",
    save: "保存",
    cacheWrite: "缓存写入",
    confidence: "置信度",
    observed: "观测时间",
    effective: "生效时间",
    enabled: "启用",
    superseded: "已替代",
    reasoningRule: "推理规则",
    yes: "是",
    no: "否",
    expand: "展开",
    collapse: "收起",
  },
}

export function useI18n(initialLanguage: DashboardLanguage = "en") {
  const [language, setLanguage] = useState<DashboardLanguage>(initialLanguage)

  const copy = useMemo(() => DICTIONARY[language], [language])

  return {
    language,
    locale: language === "zh" ? "zh-CN" : "en-US",
    copy,
    toggleLanguage() {
      setLanguage((current) => current === "en" ? "zh" : "en")
    },
  }
}
