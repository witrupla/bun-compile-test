import { read as ioRead, write as ioWrite } from "@fuman/io"
import { ip } from "@fuman/net"
import { typed } from "@fuman/utils"
import { TelegramClient } from "@mtcute/bun"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import {
  debugLog,
  installProcessDebugHandlers,
  toSerializedError,
  type SerializedError,
} from "./debug-runtime"

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

type IoProbeResult = {
  readAccess: GraphStepResult
  writeAccess: GraphStepResult
  writeCall: GraphStepResult
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

function runIoProbe(): IoProbeResult {
  debugLog("H6", "src/mtcute-graph.ts:runIoProbe:start", "starting io probe", {
    entry: process.argv[1] ?? null,
  })

  let readAccess: GraphStepResult

  try {
    readAccess = { ok: true, value: typeof ioRead.uint32le }
    debugLog("H8", "src/mtcute-graph.ts:runIoProbe:readAccess", "read uint32le accessed", {
      exportType: readAccess.value,
    })
  } catch (error: unknown) {
    const serialized = toSerializedError(error)

    readAccess = { error: serialized, ok: false }
    debugLog("H8", "src/mtcute-graph.ts:runIoProbe:readAccess", "read uint32le access failed", {
      code: serialized.code,
      message: serialized.message,
      name: serialized.name,
    })
  }

  let writeAccess: GraphStepResult

  try {
    writeAccess = { ok: true, value: typeof ioWrite.uint32le }
    debugLog("H6", "src/mtcute-graph.ts:runIoProbe:writeAccess", "write uint32le accessed", {
      exportType: writeAccess.value,
    })
  } catch (error: unknown) {
    const serialized = toSerializedError(error)

    writeAccess = { error: serialized, ok: false }
    debugLog("H6", "src/mtcute-graph.ts:runIoProbe:writeAccess", "write uint32le access failed", {
      code: serialized.code,
      message: serialized.message,
      name: serialized.name,
    })
  }

  let writeCall: GraphStepResult

  if (writeAccess.ok) {
    try {
      const bytes = new Uint8Array(4)

      ioWrite.uint32le(bytes, 0x04030201)
      writeCall = { ok: true, value: bytes.join(",") }
      debugLog("H7", "src/mtcute-graph.ts:runIoProbe:writeCall", "write uint32le succeeded", {
        bytes: bytes.join(","),
      })
    } catch (error: unknown) {
      const serialized = toSerializedError(error)

      writeCall = { error: serialized, ok: false }
      debugLog("H7", "src/mtcute-graph.ts:runIoProbe:writeCall", "write uint32le failed", {
        code: serialized.code,
        message: serialized.message,
        name: serialized.name,
      })
    }
  } else {
    writeCall = { error: writeAccess.error, ok: false }
  }

  return { readAccess, writeAccess, writeCall }
}

async function runGraph(): Promise<GraphResult> {
  const apiHash = readApiHash()
  const apiId = readApiId()
  const storage = readStoragePath()
  const ioProbe = runIoProbe()

  await ensureStorageDirectory(storage)

  debugLog("H2", "src/mtcute-graph.ts:runGraph:setup", "graph setup complete", {
    readAccessOk: ioProbe.readAccess.ok,
    writeAccessOk: ioProbe.writeAccess.ok,
    writeCallOk: ioProbe.writeCall.ok,
    apiHashLength: apiHash.length,
    apiId,
    storage,
  })

  const client = new TelegramClient({
    apiHash,
    apiId,
    disableUpdates: true,
    logLevel: 5,
    storage,
  })

  let connect: GraphStepResult

  try {
    debugLog("H4", "src/mtcute-graph.ts:runGraph:connect:start", "starting client.connect", {
      storage,
    })
    await client.connect()
    connect = { ok: true, value: "connected" }
    debugLog("H4", "src/mtcute-graph.ts:runGraph:connect:success", "client.connect succeeded", {
      storage,
    })
  } catch (error: unknown) {
    connect = { error: toSerializedError(error), ok: false }
    debugLog("H4", "src/mtcute-graph.ts:runGraph:connect:failure", "client.connect failed", {
      code: connect.error.code,
      message: connect.error.message,
      name: connect.error.name,
    })
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

installProcessDebugHandlers()

const output = {
  control: runControl(),
  graph: await runGraph(),
  marker: "mtcute-graph-repro",
}

console.log(JSON.stringify(output))
