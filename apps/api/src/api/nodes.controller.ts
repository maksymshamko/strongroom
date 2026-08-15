import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  contentQuerySchema,
  createDataRoomSchema,
  createFolderSchema,
  moveNodeSchema,
  renameNodeSchema,
  searchQuerySchema,
  type DeletePreviewDto,
} from '@dataroom/contracts';
import { NodeService } from '../application/node.service';
import { UploadService } from '../application/upload.service';
import { SearchService } from '../application/search.service';
import { ShareService } from '../application/share.service';
import type { Viewer } from '../application/access.service';
import { CurrentViewer } from './auth/viewer';
import { breadcrumbDto, nodeDto, versionDto } from './dto';
import { listOptions, pageResponse } from './pagination';
import { decodeCursor } from '../infra/prisma/cursor';

// §8.1
@Controller()
export class NodesController {
  constructor(
    private readonly nodes: NodeService,
    private readonly uploads: UploadService,
    private readonly search: SearchService,
    private readonly shares: ShareService,
  ) {}

  @Get('data-rooms')
  async listDataRooms(@CurrentViewer() viewer: Viewer, @Query() query: unknown) {
    const opts = listOptions(query);
    const result = await this.nodes.listDataRooms(viewer, opts);
    return pageResponse(result, opts.sort, (node) => nodeDto(node, { canWrite: true }));
  }

  @Post('data-rooms')
  async createDataRoom(@CurrentViewer() viewer: Viewer, @Body() body: unknown) {
    const { name } = createDataRoomSchema.parse(body);
    const node = await this.nodes.createDataRoom(viewer, name);
    return nodeDto(node, { canWrite: true });
  }

  @Get('shared-with-me')
  async sharedWithMe(@CurrentViewer() viewer: Viewer, @Query() query: unknown) {
    const opts = listOptions(query);
    const result = await this.shares.sharedWithMe(viewer, opts.limit, decodeCursor(undefined));
    return {
      items: result.items.map((row) => ({
        ...nodeDto(row.node, { canWrite: false }),
        sharedByEmail: row.sharedByEmail,
        sharedAt: row.sharedAt.toISOString(),
        shareId: row.shareId,
      })),
      nextCursor: null,
    };
  }

  @Get('nodes/:id')
  async getNode(@CurrentViewer() viewer: Viewer, @Param('id') id: string) {
    const { node, breadcrumb, canWrite } = await this.nodes.getNode(viewer, id);
    return { node: nodeDto(node, { canWrite }), breadcrumb: breadcrumbDto(breadcrumb) };
  }

  @Get('nodes/:id/children')
  async listChildren(
    @CurrentViewer() viewer: Viewer,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    const opts = listOptions(query);
    const result = await this.nodes.listChildren(viewer, id, opts);
    return pageResponse(result, opts.sort, (node) =>
      nodeDto(node, { canWrite: viewer.userId === node.ownerId }),
    );
  }

  @Post('nodes/folders')
  async createFolder(@CurrentViewer() viewer: Viewer, @Body() body: unknown) {
    const input = createFolderSchema.parse(body);
    const node = await this.nodes.createFolder(viewer, input.parentId, input.name, input.onConflict);
    return nodeDto(node, { canWrite: true });
  }

  @Patch('nodes/:id')
  async rename(@CurrentViewer() viewer: Viewer, @Param('id') id: string, @Body() body: unknown) {
    const input = renameNodeSchema.parse(body);
    const node = await this.nodes.rename(viewer, id, input.name, input.onConflict);
    return nodeDto(node, { canWrite: true });
  }

  @Post('nodes/:id/move')
  @HttpCode(200)
  async move(@CurrentViewer() viewer: Viewer, @Param('id') id: string, @Body() body: unknown) {
    const input = moveNodeSchema.parse(body);
    const node = await this.nodes.move(viewer, id, input.parentId, input.onConflict);
    return nodeDto(node, { canWrite: true });
  }

  @Get('nodes/:id/delete-preview')
  async deletePreview(
    @CurrentViewer() viewer: Viewer,
    @Param('id') id: string,
  ): Promise<DeletePreviewDto> {
    const preview = await this.nodes.deletePreview(viewer, id);
    return {
      nodeId: preview.node.id,
      name: preview.node.name,
      type: preview.node.type,
      contents: {
        files: preview.contents.files,
        folders: preview.contents.folders,
        size: preview.contents.size.toString(),
      },
      shareImpact: preview.shareImpact,
    };
  }

  @Delete('nodes/:id')
  @HttpCode(204)
  async delete(@CurrentViewer() viewer: Viewer, @Param('id') id: string) {
    await this.nodes.delete(viewer, id);
  }

  @Get('nodes/:id/versions')
  async versions(@CurrentViewer() viewer: Viewer, @Param('id') id: string) {
    const items = await this.uploads.listVersions(viewer, id);
    return { items: items.map(versionDto) };
  }

  @Get('nodes/:id/content')
  async content(
    @CurrentViewer() viewer: Viewer,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    const opts = contentQuerySchema.parse(query);
    const result = await this.uploads.contentUrl(viewer, id, opts);
    return { ...result, expiresAt: result.expiresAt.toISOString() };
  }

  // §8.5
  @Get('nodes/:id/search')
  async searchSubtree(
    @CurrentViewer() viewer: Viewer,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    const parsed = searchQuerySchema.parse(query);
    const opts = {
      limit: parsed.limit,
      cursor: decodeCursor(parsed.cursor),
      sort: parsed.sort,
      dir: parsed.dir,
    };
    const result = await this.search.search(
      viewer,
      id,
      {
        q: parsed.q,
        types: parsed.type,
        mimeTypes: parsed.mimeType,
        minSize: parsed.minSize,
        maxSize: parsed.maxSize,
        createdFrom: parsed.createdFrom,
        createdTo: parsed.createdTo,
        updatedFrom: parsed.updatedFrom,
        updatedTo: parsed.updatedTo,
      },
      opts,
    );
    return pageResponse({ items: result.items, hasMore: result.hasMore }, opts.sort, (node) => ({
      ...nodeDto(node, { canWrite: viewer.userId === node.ownerId }),
      pathLabel: (node as typeof node & { pathLabel: string }).pathLabel,
    }));
  }
}
