import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../api/app.module';
import { TrashService } from '../application/trash.service';

/** spec 003 §2.7 — the same sweep the hourly scheduler runs, on demand. */
async function main(): Promise<void> {
  process.env.DR_DISABLE_PURGE = '1';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const purged = await app.get(TrashService).purgeExpired(1000);
  console.log(`Purged ${purged} expired trash item(s)`);
  await app.close();
}

void main();
