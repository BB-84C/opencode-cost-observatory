import type { Request, Response } from "express"

export type JsonResponseCacheEntry = { body: string; expires: number; contentLength: number }

export class JsonResponseCache {
  constructor(private readonly ttlMs: number) {}
  private readonly entries = new Map<string, JsonResponseCacheEntry>()

  get(key: string, now = Date.now()) {
    const entry = this.entries.get(key)
    if (!entry || entry.expires <= now) {
      if (entry) this.entries.delete(key)
      return null
    }
    return entry
  }

  set(key: string, payload: unknown, now = Date.now()) {
    const body = JSON.stringify(payload)
    const entry = { body, expires: now + this.ttlMs, contentLength: Buffer.byteLength(body) }
    this.entries.set(key, entry)
    return entry
  }

  clear() {
    this.entries.clear()
  }
}

export const dashboardPrivateResponseCache = new JsonResponseCache(5_000)

export function buildResponseCacheKey(scope: string, routePath: string, query: Record<string, unknown> = {}) {
  const params = new URLSearchParams()
  for (const key of Object.keys(query).sort()) {
    const value = query[key]
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (item != null) params.append(key, String(item))
    }
  }
  const search = params.toString()
  return `${scope}:${routePath}${search ? `?${search}` : ""}`
}

export function buildRequestCacheKey(scope: string, req: Request) {
  return buildResponseCacheKey(scope, `${req.baseUrl}${req.path}`, req.query)
}

export function sendJsonWithOptionalCache(res: Response, key: string, cacheEnabled: boolean, producer: () => unknown) {
  if (cacheEnabled) {
    const hit = dashboardPrivateResponseCache.get(key)
    if (hit) {
      res.type("json").setHeader("Content-Length", String(hit.contentLength)).send(hit.body)
      return
    }
  }
  const payload = producer()
  if (!cacheEnabled) {
    res.json(payload)
    return
  }
  const entry = dashboardPrivateResponseCache.set(key, payload)
  res.type("json").setHeader("Content-Length", String(entry.contentLength)).send(entry.body)
}
