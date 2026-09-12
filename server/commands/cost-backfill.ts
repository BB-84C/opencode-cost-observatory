import { iterateAssistantMessagesFromRawDb } from "../services/raw-opencode"
import { openAnalyticsDb, openRawOpencodeDb } from "../storage/db"

function main() {
  const rawPath = process.env.OPENCODE_DB_PATH ?? process.argv[2]
  const analyticsPath = process.env.ANALYTICS_DB_PATH ?? process.argv[3]
  if (!rawPath || !analyticsPath) throw new Error("OPENCODE_DB_PATH and ANALYTICS_DB_PATH are required")
  const raw = openRawOpencodeDb(rawPath)
  const analytics = openAnalyticsDb(analyticsPath)
  let scanned = 0; let updated = 0; let skipped = 0
  try {
    const update = analytics.sqlite.prepare("update message_usage_fact set cost_usd = ? where message_id = ? and cost_usd <> ?")
    for (const message of iterateAssistantMessagesFromRawDb(raw)) {
      scanned += 1
      if (message.costUsd <= 0) { skipped += 1; continue }
      if (update.run(message.costUsd, message.messageId, message.costUsd).changes > 0) updated += 1
      else skipped += 1
    }
  } finally { raw.close(); analytics.sqlite.close() }
  console.log(JSON.stringify({ scanned, updated, skipped }))
}
try { main() } catch (error) { console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1 }
