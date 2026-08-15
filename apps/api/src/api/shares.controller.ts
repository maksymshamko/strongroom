import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { addPeopleSchema, type ShareStateDto } from '@dataroom/contracts';
import { ShareService } from '../application/share.service';
import { UploadService } from '../application/upload.service';
import type { Viewer } from '../application/access.service';
import { CurrentViewer, Public } from './auth/viewer';
import { breadcrumbDto, grantDto, nodeDto } from './dto';
import { listOptions, pageResponse } from './pagination';
import { WEB_URL } from './tokens';

// §8.3
@Controller()
export class SharesController {
  constructor(
    private readonly shares: ShareService,
    private readonly uploads: UploadService,
    @Inject(WEB_URL) private readonly webUrl: string,
  ) {}

  @Get('nodes/:id/shares')
  async state(@CurrentViewer() viewer: Viewer, @Param('id') id: string): Promise<ShareStateDto> {
    const state = await this.shares.state(viewer, id);
    return {
      link: state.link
        ? {
            shareId: state.link.shareId,
            token: state.link.token,
            url: `${this.webUrl}/s/${state.link.token}`,
            createdAt: state.link.createdAt.toISOString(),
          }
        : null,
      grants: state.grants.map(grantDto),
      inheritedFrom: state.inheritedFrom,
    };
  }

  @Post('nodes/:id/shares/link')
  async createLink(@CurrentViewer() viewer: Viewer, @Param('id') id: string) {
    return this.shares.createLink(viewer, id);
  }

  @Post('nodes/:id/shares/people')
  async addPeople(
    @CurrentViewer() viewer: Viewer,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { emails } = addPeopleSchema.parse(body);
    const grants = await this.shares.addPeople(viewer, id, emails);
    return { grants: grants.map(grantDto) };
  }

  @Delete('shares/:shareId')
  @HttpCode(204)
  async revokeShare(@CurrentViewer() viewer: Viewer, @Param('shareId') shareId: string) {
    await this.shares.revokeShare(viewer, shareId);
  }

  @Delete('share-grants/:grantId')
  @HttpCode(204)
  async revokeGrant(@CurrentViewer() viewer: Viewer, @Param('grantId') grantId: string) {
    await this.shares.revokeGrant(viewer, grantId);
  }
}

// §8.4 — no session required; the token is the credential.
@Controller('public/shares')
export class PublicSharesController {
  constructor(
    private readonly shares: ShareService,
    private readonly uploads: UploadService,
  ) {}

  @Public()
  @Get(':token')
  async resolve(@Param('token') token: string, @CurrentViewer() viewer: Viewer) {
    const { node, breadcrumb, share } = await this.shares.resolvePublic(token, null, {
      ...viewer,
      token,
    });
    return {
      node: nodeDto(node, { canWrite: false }),
      breadcrumb: breadcrumbDto(breadcrumb),
      share: { mode: 'PUBLIC_LINK' as const, nodeId: share.nodeId },
    };
  }

  @Public()
  @Get(':token/nodes/:id')
  async resolveNode(
    @Param('token') token: string,
    @Param('id') id: string,
    @CurrentViewer() viewer: Viewer,
  ) {
    const { node, breadcrumb, share } = await this.shares.resolvePublic(token, id, {
      ...viewer,
      token,
    });
    return {
      node: nodeDto(node, { canWrite: false }),
      breadcrumb: breadcrumbDto(breadcrumb),
      share: { mode: 'PUBLIC_LINK' as const, nodeId: share.nodeId },
    };
  }

  @Public()
  @Get(':token/nodes/:id/children')
  async children(
    @Param('token') token: string,
    @Param('id') id: string,
    @CurrentViewer() viewer: Viewer,
    @Query() query: unknown,
  ) {
    const opts = listOptions(query);
    const result = await this.shares.listPublicChildren(token, id, { ...viewer, token }, opts);
    return pageResponse(result, opts.sort, (node) => nodeDto(node, { canWrite: false }));
  }

  @Public()
  @Get(':token/nodes/:id/content')
  async content(
    @Param('token') token: string,
    @Param('id') id: string,
    @CurrentViewer() viewer: Viewer,
    @Query('download') download?: string,
  ) {
    // resolvePublic applies §5.6 scoping and writes the access log.
    await this.shares.resolvePublic(token, id, { ...viewer, token });
    const result = await this.uploads.contentUrl({ ...viewer, token }, id, {
      download: download === '1' || download === 'true',
    });
    return { ...result, expiresAt: result.expiresAt.toISOString() };
  }
}
