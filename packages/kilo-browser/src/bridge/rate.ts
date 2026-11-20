export type RateLimitOptions = {
  max: number
  windowMs: number
  now?: () => number
}

export class RateLimiter {
  private readonly max: number
  private readonly windowMs: number
  private readonly now: () => number
  private readonly hits = new Map<string, number[]>()

  constructor(options: RateLimitOptions) {
    this.max = options.max
    this.windowMs = options.windowMs
    this.now = options.now ?? Date.now
  }

  allow(key: string): boolean {
    const time = this.now()
    const recent = (this.hits.get(key) ?? []).filter((stamp) => time - stamp < this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(time)
    this.hits.set(key, recent)
    return true
  }
}
