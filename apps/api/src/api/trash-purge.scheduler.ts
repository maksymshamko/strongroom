import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TrashService } from '../application/trash.service';

const HOUR_MS = 60 * 60 * 1000;

/**
 * spec 003 §2.7 — the TTL only means something if something enforces it, so the
 * sweep runs hourly in-process. Disabled under test, where the suite drives
 * `purgeExpired()` directly and a background timer would race it.
 *
 * At real scale this belongs in a job runner (§9); the interval is the honest
 * MVP answer, not a claim that it scales.
 */
@Injectable()
export class TrashPurgeScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TrashPurge');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly trash: TrashService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.DR_DISABLE_PURGE === '1') return;

    this.timer = setInterval(() => void this.run(), HOUR_MS);
    // Never hold the process open on this alone.
    this.timer.unref?.();
    void this.run();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async run(): Promise<void> {
    try {
      const purged = await this.trash.purgeExpired();
      if (purged > 0) this.logger.log(`Purged ${purged} expired trash item(s)`);
    } catch (error) {
      // A failed sweep is not fatal — the next one retries the same rows.
      this.logger.error(error instanceof Error ? error.message : String(error));
    }
  }
}
