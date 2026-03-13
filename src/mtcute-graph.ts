import { ip } from "@fuman/net"
import { typed } from "@fuman/utils"
import { TelegramClient } from "@mtcute/bun"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

type SerializedError = {
  code: string | null
  message: string | null
  name: string | null
  stack: string | null
}

type ControlResult = {
  firstByte: number
  ipv4: string
  ipv6: string
  littleEndian16: number
  selfEqual: boolean
}

type GraphStepResult =
  | {
      ok: true
      value: string
    }
  | {
      error: SerializedError
      ok: false
    }

type GraphResult = {
  apiHashLength: number
  apiId: number
  call: GraphStepResult
  connect: GraphStepResult
  destroy: GraphStepResult
  storage: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readApiHash(): string {
  const value = process.env.API_HASH

  if (value !== undefined && value.length > 0) {
    return value
  }

  throw new Error("Missing API_HASH")
}

function readApiId(): number {
  const raw = process.env.API_ID

  if (raw === undefined) throw new Error("Missing API_ID")

  const value = Number.parseInt(raw, 10)

  if (Number.isInteger(value) && value > 0) {
    return value
  }

  throw new Error("Invalid API_ID")
}

function readStoragePath(): string {
  const value = process.env.REPRO_STORAGE

  if (value !== undefined && value.length > 0) {
    return value
  }

  const rawEntry = process.argv[1] ?? "mtcute-graph"
  const storageName = rawEntry.replaceAll(/[^a-zA-Z0-9]+/g, "-").replaceAll(/^-|-$/g, "")

  return `data/${storageName || "mtcute-graph"}.session`
}

async function ensureStorageDirectory(storage: string): Promise<void> {
  const directory = dirname(storage)

  if (directory !== ".") {
    await mkdir(directory, { recursive: true })
  }
}

function toSerializedError(error: unknown): SerializedError {
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

function runControl(): ControlResult {
  const sampleBytes = new Uint8Array([1, 2, 3, 4])
  const view = typed.toDataView(sampleBytes)

  return {
    firstByte: view.getUint8(0),
    ipv4: ip.prettify("149.154.167.50"),
    ipv6: ip.prettify("2001:db8::1", { encloseIpv6: true }),
    littleEndian16: view.getUint16(0, true),
    selfEqual: typed.equal(sampleBytes, sampleBytes),
  }
}

function createGetConfigRequest(): { _: "help.getConfig" } {
  return { _: "help.getConfig" }
}

function toCallValue(result: unknown): string {
  if (isRecord(result)) {
    const resultType = result._

    if (typeof resultType === "string") {
      return resultType
    }
  }

  return typeof result
}

async function runGraph(): Promise<GraphResult> {
  const apiHash = readApiHash()
  const apiId = readApiId()
  const storage = readStoragePath()

  await ensureStorageDirectory(storage)

  const client = new TelegramClient({
    apiHash,
    apiId,
    disableUpdates: true,
    logLevel: 5,
    storage,
  })

  let connect: GraphStepResult

  try {
    await client.connect()
    connect = { ok: true, value: "connected" }
  } catch (error: unknown) {
    connect = { error: toSerializedError(error), ok: false }
  }

  let call: GraphStepResult

  if (connect.ok) {
    try {
      const result = await client.call(createGetConfigRequest())
      call = { ok: true, value: toCallValue(result) }
    } catch (error: unknown) {
      call = { error: toSerializedError(error), ok: false }
    }
  } else {
    call = { error: connect.error, ok: false }
  }

  let destroy: GraphStepResult

  try {
    await client.disconnect()
    await client.destroy()
    destroy = { ok: true, value: "destroyed" }
  } catch (error: unknown) {
    destroy = { error: toSerializedError(error), ok: false }
  }

  return {
    apiHashLength: apiHash.length,
    apiId,
    call,
    connect,
    destroy,
    storage,
  }
}

const output = {
  control: runControl(),
  graph: await runGraph(),
  marker: "mtcute-graph-repro",
}

console.log(JSON.stringify(output))
