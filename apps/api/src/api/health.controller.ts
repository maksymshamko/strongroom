import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { Public } from './auth/viewer';

/**
 * spec 004 §1, §2.5 — the readiness signal for CI, Docker and nginx.
 *
 * It touches the database on purpose: a process that is listening but cannot
 * reach Postgres is not ready, and reporting it as ready is how a deploy goes
 * green while every request fails.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, service: 'api' };
  }
}
