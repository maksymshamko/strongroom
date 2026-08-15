import type { INestApplication } from '@nestjs/common';
import { DomainExceptionFilter } from './domain-exception.filter';

/**
 * Wiring shared by `main.ts` and the test harness, so the suite exercises the
 * same prefix, filters and serialization the real server does.
 */
export function bootstrapApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new DomainExceptionFilter());
}

// §4.1 — BigInt is serialized as a decimal string, not a number, so sizes
// beyond 2^53 survive the round trip.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function toJSON(this: bigint) {
  return this.toString();
};
