import path from "node:path"
import { mkdir } from "node:fs/promises"
import { checkJail } from "../policy/jail"
import { artifactName, safeSegment } from "./naming"
import { DEFAULT_REDACTION, redactData, type RedactionOptions } from "../policy/redact"

export type StoreOptions = {
  workspace: string
  artifactsDir?: string
  maxBytes?: number
  redaction?: RedactionOptions
}

export type WriteInput = {
  sessionID: string
  tool: string
  params: unknown
  data: Uint8Array | ArrayBuffer | string
  ext: string
}

export type Artifact = {
  name: string
  path: string
  relativePath: string
  bytes: number
}

export class ArtifactStore {
  private readonly workspace: string
  private readonly root: string
  private readonly maxBytes: number
  private readonly redaction: RedactionOptions
  private readonly counters = new Map<string, number>()

  constructor(options: StoreOptions) {
    this.workspace = path.resolve(options.workspace)
    this.root = path.resolve(options.workspace, options.artifactsDir ?? ".kilo/kilo-browser/artifacts")
    this.maxBytes = options.maxBytes ?? 2_097_152
    this.redaction = options.redaction ?? DEFAULT_REDACTION
  }

  get directory() {
    return this.root
  }

  async write(input: WriteInput): Promise<Artifact> {
    await checkJail([this.workspace], this.root)
    const session = safeSegment(input.sessionID)
    const dir = path.resolve(this.root, session)
    await checkJail([this.root], dir)
    await mkdir(dir, { recursive: true })
    const bytes = encode(redactData(input.data, input.ext, this.redaction))
    if (bytes.byteLength > this.maxBytes) {
      throw new Error(`artifact exceeds max size ${this.maxBytes}`)
    }
    const seq = this.counters.get(session) ?? 0
    let current = seq + 1
    let name = artifactName({ seq: current, tool: input.tool, params: input.params, ext: input.ext, redaction: this.redaction })
    let file = path.resolve(dir, name)
    while (await Bun.file(file).exists()) {
      current += 1
      name = artifactName({
        seq: current,
        tool: input.tool,
        params: input.params,
        ext: input.ext,
        redaction: this.redaction,
      })
      file = path.resolve(dir, name)
    }
    await checkJail([this.root], file)
    await Bun.write(file, bytes)
    this.counters.set(session, current)
    return {
      name,
      path: file,
      relativePath: path.relative(this.workspace, file),
      bytes: bytes.byteLength,
    }
  }
}

function encode(data: Uint8Array | ArrayBuffer | string) {
  if (typeof data === "string") return new TextEncoder().encode(data)
  if (data instanceof Uint8Array) return data
  return new Uint8Array(data)
}
