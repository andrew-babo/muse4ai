/** Per-job page leases. Main-page users (quota/login) remain coordinated by Coordinator. */
export class UiWorkPool<T> {
  private slots = new Map<string, { accountId: string; value: T; primary: boolean; jobId: string | null; timer?: ReturnType<typeof setTimeout> }>();
  constructor(private create: (accountId: string, key: string, primary: boolean) => T, private destroy: (value: T, primary: boolean) => void, private idleMs = 60_000) {}

  acquire(accountId: string, jobId: string): T {
    for (const s of this.slots.values()) if (s.accountId === accountId && s.jobId === jobId) return s.value;
    for (const s of this.slots.values()) {
      if (s.accountId !== accountId || s.jobId !== null) continue;
      if (s.timer) clearTimeout(s.timer);
      s.timer = undefined;
      s.jobId = jobId;
      return s.value;
    }
    const primary = ![...this.slots.values()].some(s => s.accountId === accountId && s.primary);
    const key = `${accountId}#work#${jobId}`;
    const value = this.create(accountId, key, primary);
    this.slots.set(key, { accountId, value, primary, jobId });
    return value;
  }

  release(accountId: string, jobId: string): void {
    for (const [key, s] of this.slots) {
      if (s.accountId !== accountId || s.jobId !== jobId) continue;
      s.jobId = null;
      if (s.primary) continue;
      s.timer = setTimeout(() => {
        if (s.jobId !== null || this.slots.get(key) !== s) return;
        this.slots.delete(key);
        this.destroy(s.value, false);
      }, this.idleMs);
      s.timer.unref?.();
    }
  }

  remove(accountId?: string): void {
    for (const [key, s] of this.slots) {
      if (accountId !== undefined && s.accountId !== accountId) continue;
      if (s.timer) clearTimeout(s.timer);
      this.slots.delete(key);
      this.destroy(s.value, s.primary);
    }
  }
}