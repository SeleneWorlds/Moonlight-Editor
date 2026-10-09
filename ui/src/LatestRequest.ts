/** Send the latest value at most once per interval; release can flush immediately. */
export function latestRequest<T>(send: (value: T) => void, intervalMs = 50) {
  let pending: T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function cancel(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = undefined;
    pending = undefined;
  }
  function flush(): void {
    const value = pending;
    cancel();
    if (value !== undefined) {
      send(value);
    }
  }
  return {
    push(value: T): void {
      pending = value;
      timer ??= setTimeout(flush, intervalMs);
    },
    flush,
    cancel,
  };
}
