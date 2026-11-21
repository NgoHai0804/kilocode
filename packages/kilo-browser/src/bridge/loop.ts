/**
 * Detects an agent retrying the same failing tool call.
 *
 * A repeated identical call that keeps failing is a loop, not progress: every
 * attempt costs an LLM turn and can block for the tool timeout, so a stuck
 * agent feels slow. After `maxRepeats` consecutive failures the guard reports
 * the signature as blocked, letting the bridge answer LOOP_STOP immediately
 * without touching the extension and telling the agent to summarize evidence
 * instead of retrying.
 *
 * Only failures count; a successful call clears its signature so legitimate
 * repeated reads (snapshot, get_text, console) are never blocked.
 */
export type LoopGuardOptions = {
  maxRepeats?: number
  windowMs?: number
  maxEntries?: number
  now?: () => number
}

type Run = { count: number; firstAt: number }

export class LoopGuard {
  private readonly max: number
  private readonly windowMs: number
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly runs = new Map<string, Run>()

  constructor(options: LoopGuardOptions = {}) {
    this.max = options.maxRepeats ?? 3
    this.windowMs = options.windowMs ?? 120_000
    this.maxEntries = options.maxEntries ?? 500
    this.now = options.now ?? Date.now
  }

  /** Number of tracked signatures; exposed so the map stays observable. */
  get size() {
    return this.runs.size
  }

  /** True when this signature already failed enough times in the window. */
  blocked(key: string) {
    const run = this.runs.get(key)
    if (!run) return false
    if (this.now() - run.firstAt > this.windowMs) {
      this.runs.delete(key)
      return false
    }
    return run.count >= this.max
  }

  /** Record a failure, extending the current run or starting a fresh one. */
  fail(key: string) {
    const time = this.now()
    const run = this.runs.get(key)
    if (!run || time - run.firstAt > this.windowMs) {
      if (!run) this.sweep(time)
      this.runs.set(key, { count: 1, firstAt: time })
      return
    }
    run.count += 1
  }

  /** Clear the run: the same call just succeeded. */
  pass(key: string) {
    this.runs.delete(key)
  }

  /**
   * Keep the map bounded: drop expired runs first, then the oldest run when the
   * cap is still reached so a long session cannot grow it without limit.
   */
  private sweep(time: number) {
    if (this.runs.size < this.maxEntries) return
    for (const [key, run] of this.runs) {
      if (time - run.firstAt > this.windowMs) this.runs.delete(key)
    }
    let oldestKey: string | undefined
    let oldest = Infinity
    for (const [key, run] of this.runs) {
      if (run.firstAt < oldest) {
        oldest = run.firstAt
        oldestKey = key
      }
    }
    if (oldestKey !== undefined) this.runs.delete(oldestKey)
  }
}

export const loopGuard = new LoopGuard()
