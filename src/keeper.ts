import { SubmissionStore } from "./domain.js";
import { EscrowProvider } from "./provider.js";

export class ReclaimKeeper {
  private running = false;

  constructor(private readonly store: SubmissionStore, private readonly provider: EscrowProvider) {}

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const candidate of this.store.listReclaimCandidates()) {
        const reclaimable = candidate.outcome === "pending"
          ? this.store.markIgnoredExpired(candidate.id)
          : candidate;
        const idempotencyKey = `keeper:reclaim:${reclaimable.id}`;
        const prior = this.store.getIdempotent<{ transactionHash: string }>(idempotencyKey);
        const transactionHash = prior?.transactionHash ?? await this.provider.triggerReclaim(reclaimable);
        if (!prior) this.store.rememberIdempotent(idempotencyKey, "keeper_reclaim", { transactionHash });
        const evidence = await this.provider.reclaim(reclaimable, { transactionHash });
        this.store.settle(reclaimable.id, "reclaim", {
          ...evidence,
          idempotencyKey: `reclaim:${reclaimable.id}`
        });
      }
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = Number(process.env.SURETY_KEEPER_INTERVAL_MS ?? 60_000)): NodeJS.Timeout {
    const run = (): void => {
      void this.runOnce().catch((error: unknown) => {
        console.error("Surety reclaim keeper failed", error instanceof Error ? error.message : error);
      });
    };
    run();
    return setInterval(run, intervalMs);
  }
}
