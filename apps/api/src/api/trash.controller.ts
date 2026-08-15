import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { restoreSchema, type TrashItemDto, type TrashResponse } from '@dataroom/contracts';
import { TrashService } from '../application/trash.service';
import type { Viewer } from '../application/access.service';
import { CurrentViewer } from './auth/viewer';
import { nodeDto } from './dto';
import { listOptions } from './pagination';
import { encodeCursor } from '../infra/prisma/cursor';

// spec 003 §2.5, §2.6 — owner-only; there is no share path to a TRASH node.
@Controller('trash')
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @Get()
  async list(@CurrentViewer() viewer: Viewer, @Query() query: unknown): Promise<TrashResponse> {
    const opts = listOptions(query);
    const result = await this.trash.list(viewer, { limit: opts.limit, cursor: opts.cursor });

    const last = result.items[result.items.length - 1];
    return {
      // Null before the user's first delete — no TRASH row exists yet (§2.5).
      node: result.node ? nodeDto(result.node, { canWrite: true }) : null,
      items: result.items.map((node): TrashItemDto => {
        const dto = nodeDto(node, { canWrite: true });
        return {
          ...dto,
          // §2.5 — the original name. The Trash-internal de-duplicated form
          // (§2.3) never leaves the server; deletedFromLabel is what tells two
          // same-named entries apart.
          name: node.previousName ?? dto.name,
          deletedAt: (node.deletedAt ?? node.updatedAt).toISOString(),
          deletedFromLabel: node.deletedFromLabel ?? '',
        };
      }),
      nextCursor: result.hasMore && last ? encodeCursor(last, 'deletedAt') : null,
    };
  }

  // §2.7 — permanent deletion. No undo, hence its own explicit route.
  @Delete()
  @HttpCode(204)
  async empty(@CurrentViewer() viewer: Viewer) {
    await this.trash.empty(viewer);
  }

  @Delete(':nodeId')
  @HttpCode(204)
  async purgeOne(@CurrentViewer() viewer: Viewer, @Param('nodeId') nodeId: string) {
    await this.trash.purgeOne(viewer, nodeId);
  }

  @Post(':nodeId/restore')
  @HttpCode(200)
  async restore(
    @CurrentViewer() viewer: Viewer,
    @Param('nodeId') nodeId: string,
    @Body() body: unknown,
  ) {
    const { onConflict } = restoreSchema.parse(body ?? {});
    const node = await this.trash.restore(viewer, nodeId, onConflict);
    return nodeDto(node, { canWrite: true });
  }
}
