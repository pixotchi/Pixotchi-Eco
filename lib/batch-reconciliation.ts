export type BatchScanState<T> = {
  items: T[];
  loading: boolean;
  ready: boolean;
  error: string | null;
};

/** One owner for scans, including refresh events that arrive during a receipt scan. */
export class BatchReconciliation<T> {
  state: BatchScanState<T> = { items: [], loading: false, ready: false, error: null };
  private retired = new Set<string>();
  private revision = 0;
  private minimumBlock: bigint | undefined;
  private inFlight: Promise<boolean> | null = null;
  private disposed = false;

  constructor(
    private readonly read: (minimumBlock?: bigint) => Promise<T[]>,
    private readonly key: (item: T) => string,
    private readonly publish: (state: BatchScanState<T>) => void,
    private readonly errorMessage: string,
  ) {}

  private update(update: Partial<BatchScanState<T>>) {
    this.state = { ...this.state, ...update };
    if (!this.disposed) this.publish(this.state);
  }

  /** Retire the submitted snapshot before any asynchronous reconciliation starts. */
  retire(items: readonly T[], receiptBlock?: bigint) {
    if (this.disposed) return;
    for (const item of items) this.retired.add(this.key(item));
    if (receiptBlock !== undefined && (this.minimumBlock === undefined || receiptBlock > this.minimumBlock)) {
      this.minimumBlock = receiptBlock;
    }
    this.revision += 1;
    this.update({
      items: this.state.items.filter((item) => !this.retired.has(this.key(item))),
      ready: false,
      loading: true,
      error: null,
    });
  }

  refresh = (receiptBlock?: bigint): Promise<boolean> => {
    if (this.disposed) return Promise.resolve(false);
    if (receiptBlock !== undefined && (this.minimumBlock === undefined || receiptBlock > this.minimumBlock)) {
      this.minimumBlock = receiptBlock;
      this.revision += 1;
    }
    if (this.inFlight) return this.inFlight;
    this.update({ ready: false, loading: true, error: null });
    this.inFlight = this.scan().finally(() => { this.inFlight = null; });
    return this.inFlight;
  };

  private async scan(): Promise<boolean> {
    // A new receipt invalidates an older in-flight read. Its callers share this
    // promise, which resolves only after the latest required block is read.
    while (!this.disposed) {
      const revision = this.revision;
      try {
        const items = await this.read(this.minimumBlock);
        if (this.disposed) return false;
        if (revision !== this.revision) continue;
        this.update({
          items: items.filter((item) => !this.retired.has(this.key(item))),
          ready: true,
          loading: false,
          error: null,
        });
        this.retired.clear();
        return true;
      } catch {
        if (this.disposed) return false;
        if (revision !== this.revision) continue;
        // Last-known rows may remain visible, but can never be submitted.
        this.update({ ready: false, loading: false, error: this.errorMessage });
        return false;
      }
    }
    return false;
  }

  dispose() {
    this.disposed = true;
  }

  activate() {
    this.disposed = false;
  }

  assertReady(expected: readonly T[]) {
    const available = new Set(this.state.items.map(this.key));
    if (this.disposed || !this.state.ready || expected.length === 0 || expected.some((item) => !available.has(this.key(item)))) {
      throw new Error("This batch is updating. Wait for the scan to finish, or retry the scan.");
    }
  }
}
