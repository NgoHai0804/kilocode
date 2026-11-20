type Resolvers<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

type PromiseWithResolvers = <T>() => Resolvers<T>

const target = Promise as unknown as { withResolvers?: PromiseWithResolvers }

if (typeof target.withResolvers !== "function") {
  target.withResolvers = function withResolvers<T>(): Resolvers<T> {
    const box = {} as Resolvers<T>
    box.promise = new Promise<T>((resolve, reject) => {
      box.resolve = resolve
      box.reject = reject
    })
    return box
  }
}