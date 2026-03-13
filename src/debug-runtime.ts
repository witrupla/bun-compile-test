export type SerializedError = {
  code: string | null
  message: string | null
  name: string | null
  stack: string | null
}

type DebugValue = boolean | number | string | null

type DebugData = Record<string, DebugValue>

const debugRunId = (process.argv[1] ?? "unknown").includes("/dist/") ? "bundled" : "source"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function debugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: DebugData,
): void {
  // #region agent log
  void fetch("http://127.0.0.1:7574/ingest/19f9dcb8-3956-4d78-a84a-4e2ef15fca70", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "525003",
    },
    body: JSON.stringify({
      sessionId: "525003",
      runId: debugRunId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion
}

export function toSerializedError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const code = isRecord(error) ? error.code : null

    return {
      code: typeof code === "string" ? code : null,
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
    }
  }

  if (isRecord(error)) {
    const code = error.code
    const message = error.message
    const name = error.name
    const stack = error.stack

    return {
      code: typeof code === "string" ? code : null,
      message:
        typeof message === "string"
          ? message
          : (JSON.stringify(error) ?? "Unserializable object error"),
      name: typeof name === "string" ? name : null,
      stack: typeof stack === "string" ? stack : null,
    }
  }

  return {
    code: null,
    message: String(error),
    name: null,
    stack: null,
  }
}

export function installProcessDebugHandlers(): void {
  process.on("uncaughtException", (error) => {
    debugLog("H5", "src/debug-runtime.ts:process:uncaughtException", "uncaught exception", {
      message: error.message,
      name: error.name,
    })
  })

  process.on("unhandledRejection", (reason) => {
    const error = toSerializedError(reason)

    debugLog("H5", "src/debug-runtime.ts:process:unhandledRejection", "unhandled rejection", {
      code: error.code,
      message: error.message,
      name: error.name,
    })
  })
}
