import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const defaultDashboardConfigPath = path.join(projectRoot, "dashboard.config.json")
const defaultEnvFilePath = path.join(projectRoot, ".env")

type LoadConfigOptions = {
  dashboardConfigPath?: string
  envFilePath?: string
}

const fileConfigSchema = z.object({
  port: z.number().int().positive().max(65535).optional(),
  host: z.string().trim().min(1).optional(),
  opencodeDbPath: z.string().trim().min(1).optional(),
  analyticsDbPath: z.string().trim().min(1).optional(),
  pricingDbPath: z.string().trim().min(1).optional(),
  dashboardToken: z.string().trim().min(1).optional(),
  dashboardTokenFile: z.string().trim().min(1).optional(),
})

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).default(41777),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  OPENCODE_DB_PATH: z.string().trim().min(1).default(path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")),
  ANALYTICS_DB_PATH: z.string().trim().min(1).default("./.run/analytics.db"),
  PRICING_DB_PATH: z.string().trim().min(1).default(path.join(os.homedir(), ".local", "share", "opencode-cost-observatory", "pricing.db")),
  DASHBOARD_TOKEN: z.string().trim().min(1).optional(),
  DASHBOARD_TOKEN_FILE: z.string().trim().min(1).optional(),
  BB84_VPS_MODE: z.enum(["local", "ingest"]).default("local"),
  INGEST_TOKEN: z.string().trim().min(1).optional(),
  BOOTSTRAP_TOKEN: z.string().trim().min(1).optional(),
  WEBAUTHN_RP_ID: z.string().trim().min(1).default("tokenobs.bb84.ai"),
  WEBAUTHN_RP_NAME: z.string().trim().min(1).default("BB84 OpenCode Observatory"),
  WEBAUTHN_ORIGIN: z.string().trim().url().default("https://tokenobs.bb84.ai"),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
  AUTH_DB_PATH: z.string().trim().min(1).default("./.run/auth.db"),
  ADMIN_NAME: z.string().trim().min(1).default("admin"),
  AUTH_ENCRYPTION_KEY: z.string().min(32).optional(),
})

export type AppConfig = {
  port: number
  host: string
  opencodeDbPath: string
  analyticsDbPath: string
  pricingDbPath: string
  dashboardToken?: string
  dashboardTokenFilePath?: string
  bb84VpsMode: "local" | "ingest"
  ingestToken?: string
  bootstrapToken?: string
  webAuthnRpId: string
  webAuthnRpName: string
  webAuthnOrigin: string
  authSessionTtlSeconds: number
  authDbPath: string
  adminName: string
  authEncryptionKey?: string
  clientDistPath?: string
}

function resolveProjectPath(target: string) {
  return path.isAbsolute(target) ? target : path.resolve(projectRoot, target)
}

function loadDashboardFileConfig(configPath = defaultDashboardConfigPath) {
  if (!fs.existsSync(configPath)) {
    return {}
  }

  const raw = fs.readFileSync(configPath, "utf8")
  const parsed = JSON.parse(raw) as unknown
  return fileConfigSchema.parse(parsed)
}

function loadDotEnvConfig(envFilePath = defaultEnvFilePath) {
  if (!fs.existsSync(envFilePath)) {
    return {}
  }

  const parsed: Record<string, string> = {}
  const lines = fs.readFileSync(envFilePath, "utf8").split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (key) {
      parsed[key] = value
    }
  }

  return parsed
}

export function readDashboardTokenFile(tokenFilePath: string) {
  const raw = fs.readFileSync(tokenFilePath, "utf8").trim()

  if (!raw) {
    throw new Error(`Dashboard token file is empty: ${tokenFilePath}`)
  }

  if (raw.startsWith("{")) {
    const parsed = z.object({ token: z.string().trim().min(1) }).parse(JSON.parse(raw) as unknown)
    return parsed.token
  }

  return raw
}

export function loadConfig(
  input: Record<string, string | undefined> = process.env,
  options: LoadConfigOptions = {},
): AppConfig {
  const fileConfig = loadDashboardFileConfig(options.dashboardConfigPath ?? defaultDashboardConfigPath)
  const envFileConfig = loadDotEnvConfig(options.envFilePath ?? defaultEnvFilePath)
  const env = envSchema.parse({
    PORT: input.PORT ?? envFileConfig.PORT ?? fileConfig.port,
    HOST: input.HOST ?? envFileConfig.HOST ?? fileConfig.host,
    OPENCODE_DB_PATH: input.OPENCODE_DB_PATH ?? envFileConfig.OPENCODE_DB_PATH ?? fileConfig.opencodeDbPath,
    ANALYTICS_DB_PATH: input.ANALYTICS_DB_PATH ?? envFileConfig.ANALYTICS_DB_PATH ?? fileConfig.analyticsDbPath,
    PRICING_DB_PATH: input.PRICING_DB_PATH ?? envFileConfig.PRICING_DB_PATH ?? fileConfig.pricingDbPath,
    DASHBOARD_TOKEN: input.DASHBOARD_TOKEN ?? envFileConfig.DASHBOARD_TOKEN ?? fileConfig.dashboardToken,
    DASHBOARD_TOKEN_FILE: input.DASHBOARD_TOKEN_FILE ?? envFileConfig.DASHBOARD_TOKEN_FILE ?? fileConfig.dashboardTokenFile,
    BB84_VPS_MODE: input.BB84_VPS_MODE ?? envFileConfig.BB84_VPS_MODE,
    INGEST_TOKEN: input.INGEST_TOKEN ?? envFileConfig.INGEST_TOKEN,
    BOOTSTRAP_TOKEN: input.BOOTSTRAP_TOKEN ?? envFileConfig.BOOTSTRAP_TOKEN,
    WEBAUTHN_RP_ID: input.WEBAUTHN_RP_ID ?? envFileConfig.WEBAUTHN_RP_ID,
    WEBAUTHN_RP_NAME: input.WEBAUTHN_RP_NAME ?? envFileConfig.WEBAUTHN_RP_NAME,
    WEBAUTHN_ORIGIN: input.WEBAUTHN_ORIGIN ?? envFileConfig.WEBAUTHN_ORIGIN,
    AUTH_SESSION_TTL_SECONDS: input.AUTH_SESSION_TTL_SECONDS ?? envFileConfig.AUTH_SESSION_TTL_SECONDS,
    AUTH_DB_PATH: input.AUTH_DB_PATH ?? envFileConfig.AUTH_DB_PATH,
    ADMIN_NAME: input.ADMIN_NAME ?? envFileConfig.ADMIN_NAME,
    AUTH_ENCRYPTION_KEY: input.AUTH_ENCRYPTION_KEY ?? envFileConfig.AUTH_ENCRYPTION_KEY,
  })

  const dashboardTokenFilePath = env.DASHBOARD_TOKEN_FILE ? resolveProjectPath(env.DASHBOARD_TOKEN_FILE) : undefined
  const dashboardToken = env.DASHBOARD_TOKEN
    ?? (dashboardTokenFilePath ? readDashboardTokenFile(dashboardTokenFilePath) : undefined)

  if (env.BB84_VPS_MODE === "local" && !dashboardToken) {
    throw new Error("DASHBOARD_TOKEN or DASHBOARD_TOKEN_FILE is required")
  }

  if (env.BB84_VPS_MODE === "ingest" && !env.INGEST_TOKEN) {
    throw new Error("INGEST_TOKEN is required when BB84_VPS_MODE=ingest")
  }

  if (env.BB84_VPS_MODE === "ingest" && !env.BOOTSTRAP_TOKEN) {
    throw new Error("BOOTSTRAP_TOKEN is required when BB84_VPS_MODE=ingest")
  }

  if (env.BB84_VPS_MODE === "ingest" && !env.AUTH_ENCRYPTION_KEY) {
    throw new Error("AUTH_ENCRYPTION_KEY is required when BB84_VPS_MODE=ingest")
  }

  return {
    port: env.PORT,
    host: env.HOST,
    opencodeDbPath: resolveProjectPath(env.OPENCODE_DB_PATH),
    analyticsDbPath: resolveProjectPath(env.ANALYTICS_DB_PATH),
    pricingDbPath: resolveProjectPath(env.PRICING_DB_PATH),
    dashboardToken,
    dashboardTokenFilePath,
    bb84VpsMode: env.BB84_VPS_MODE,
    ingestToken: env.INGEST_TOKEN,
    bootstrapToken: env.BOOTSTRAP_TOKEN,
    webAuthnRpId: env.WEBAUTHN_RP_ID,
    webAuthnRpName: env.WEBAUTHN_RP_NAME,
    webAuthnOrigin: env.WEBAUTHN_ORIGIN,
    authSessionTtlSeconds: env.AUTH_SESSION_TTL_SECONDS,
    authDbPath: resolveProjectPath(env.AUTH_DB_PATH),
    adminName: env.ADMIN_NAME,
    authEncryptionKey: env.AUTH_ENCRYPTION_KEY,
  }
}
