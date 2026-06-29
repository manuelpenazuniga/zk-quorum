export interface RelayTask<T> {
  readonly id: string;
  readonly run: () => Promise<T>;
}

export interface RelayQueue<T> {
  submit(task: RelayTask<T>): Promise<T>;
  drain(): Promise<void>;
  size(): number;
  inFlight(): number;
}

interface QueuedTask<T> {
  task: RelayTask<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason: unknown) => void;
}

export interface RelayQueueOptions {
  readonly concurrency: number;
}

export function createPerAccountRelayQueue<T>(options: RelayQueueOptions): RelayQueue<T> {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("concurrency must be a positive integer");
  }
  const lanes = new Map<string, QueuedTask<T>[]>();
  const running = new Map<string, number>();
  let totalQueued = 0;
  let totalInFlight = 0;

  const pump = (account: string): void => {
    const active = running.get(account) ?? 0;
    if (active >= options.concurrency) return;
    const lane = lanes.get(account);
    if (!lane || lane.length === 0) return;
    const next = lane.shift()!;
    totalQueued -= 1;
    totalInFlight += 1;
    running.set(account, active + 1);
    void Promise.resolve()
      .then(() => next.task.run())
      .then(
        (v) => next.resolve(v),
        (e) => next.reject(e),
      )
      .finally(() => {
        totalInFlight -= 1;
        const cur = running.get(account) ?? 0;
        if (cur <= 1) running.delete(account);
        else running.set(account, cur - 1);
        pump(account);
      });
  };

  return {
    submit(task) {
      return new Promise<T>((resolve, reject) => {
        const entry: QueuedTask<T> = { task, resolve, reject };
        const lane = lanes.get(task.id) ?? [];
        lane.push(entry);
        lanes.set(task.id, lane);
        totalQueued += 1;
        pump(task.id);
      });
    },
    async drain() {
      while (totalQueued > 0 || totalInFlight > 0) {
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    size: () => totalQueued,
    inFlight: () => totalInFlight,
  };
}
