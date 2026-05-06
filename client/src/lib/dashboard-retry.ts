import { isRetryableAnalyticsBusyError } from "./dashboard-api-error"

type RetryOptions = {
  maxAttempts?: number
  delay?: (ms: number) => Promise<void>
}

function defaultDelay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function retryAnalyticsBusy<T>(operation: () => Promise<T>, options: RetryOptions = {}) {
  const maxAttempts = options.maxAttempts ?? 3
  const delay = options.delay ?? defaultDelay

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isRetryableAnalyticsBusyError(error) || attempt === maxAttempts - 1) {
        throw error
      }
      await delay(250 * (attempt + 1))
    }
  }

  throw new Error("retry_attempts_exhausted")
}
