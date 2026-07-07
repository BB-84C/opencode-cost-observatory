import { createHash, timingSafeEqual } from "node:crypto"
import { Router } from "express"
import { z } from "zod"

import { openAnalyticsDb } from "../storage/db"

const messageUsageFactSchema = z.object({
  message_id: z.string().trim().min(1),
  session_id: z.string().trim().min(1),
  project_id: z.string().trim().min(1),
  parent_message_id: z.string().trim().min(1).nullable().optional(),
  provider_id: z.string().trim().min(1),
  model_id: z.string().trim().min(1),
  time_created: z.number().int(),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  reasoning_tokens: z.number().int(),
  cache_read_tokens: z.number().int(),
  cache_write_tokens: z.number().int(),
  total_tokens: z.number().int(),
})

const sessionTreeEdgeSchema = z.object({
  session_id: z.string().trim().min(1),
  parent_session_id: z.string().trim().min(1).nullable().optional(),
  project_id: z.string().trim().min(1),
  directory: z.string().trim().min(1),
  title: z.string(),
  time_created: z.number().int(),
})

const ingestBodySchema = z.object({
  messages: z.array(messageUsageFactSchema),
  sessions: z.array(sessionTreeEdgeSchema),
})

type MessageUsageFactRow = z.infer<typeof messageUsageFactSchema>
type SessionTreeEdgeRow = z.infer<typeof sessionTreeEdgeSchema>

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest()
}

function isAuthorized(rawAuthorization: string | undefined, ingestToken: string) {
  const match = /^Bearer\s+(.+)$/i.exec(rawAuthorization ?? "")
  if (!match) {
    return false
  }

  return timingSafeEqual(tokenDigest(match[1]), tokenDigest(ingestToken))
}

export function ingestRoutes(analyticsDbPath: string, ingestToken: string) {
  const router = Router()

  router.post("/ingest", (req, res) => {
    res.setHeader("X-Ingest-Server-Time", String(Date.now()))

    if (!isAuthorized(req.header("authorization"), ingestToken)) {
      res.status(401).json({ error: "unauthorized" })
      return
    }

    const parsed = ingestBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_ingest_batch",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      })
      return
    }

    const db = openAnalyticsDb(analyticsDbPath)
    try {
      const insertMessage = db.sqlite.prepare(`
        insert into message_usage_fact (
          message_id, session_id, project_id, parent_message_id, provider_id, model_id, time_created,
          input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(message_id) do nothing
      `)

      const upsertSession = db.sqlite.prepare(`
        insert into session_tree_edge (session_id, parent_session_id, project_id, directory, title, time_created)
        values (?, ?, ?, ?, ?, ?)
        on conflict(session_id) do update set
          title = excluded.title,
          directory = excluded.directory,
          project_id = excluded.project_id
      `)

      const applyBatch = (messages: MessageUsageFactRow[], sessions: SessionTreeEdgeRow[]) => {
        let insertedMessages = 0
        let upsertedSessions = 0

        db.sqlite.exec("begin immediate")
        try {
          for (const session of sessions) {
            upsertedSessions += upsertSession.run(
              session.session_id,
              session.parent_session_id ?? null,
              session.project_id,
              session.directory,
              session.title,
              session.time_created,
            ).changes
          }

          for (const message of messages) {
            insertedMessages += insertMessage.run(
              message.message_id,
              message.session_id,
              message.project_id,
              message.parent_message_id ?? null,
              message.provider_id,
              message.model_id,
              message.time_created,
              message.input_tokens,
              message.output_tokens,
              message.reasoning_tokens,
              message.cache_read_tokens,
              message.cache_write_tokens,
              message.total_tokens,
            ).changes
          }

          db.sqlite.exec("commit")
        } catch (error) {
          db.sqlite.exec("rollback")
          throw error
        }

        return { insertedMessages, upsertedSessions }
      }

      const result = applyBatch(parsed.data.messages, parsed.data.sessions)
      res.json({
        inserted: { messages: result.insertedMessages, sessions: result.upsertedSessions },
        skipped: { messages: parsed.data.messages.length - result.insertedMessages },
      })
    } finally {
      db.sqlite.close()
    }
  })

  return router
}
