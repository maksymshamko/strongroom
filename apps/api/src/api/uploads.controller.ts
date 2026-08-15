import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { completeUploadSchema, initUploadSchema } from '@dataroom/contracts';
import { UploadService } from '../application/upload.service';
import type { Viewer } from '../application/access.service';
import { CurrentViewer } from './auth/viewer';
import { nodeDto } from './dto';

// §8.2
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadService) {}

  @Post('init')
  async init(@CurrentViewer() viewer: Viewer, @Body() body: unknown) {
    const input = initUploadSchema.parse(body);
    const result = await this.uploads.init(viewer, input);
    return { ...result, expiresAt: result.expiresAt.toISOString() };
  }

  @Post(':uploadId/complete')
  async complete(
    @CurrentViewer() viewer: Viewer,
    @Param('uploadId') uploadId: string,
    @Body() body: unknown,
  ) {
    const input = completeUploadSchema.parse(body ?? {});
    const node = await this.uploads.complete(viewer, uploadId, input);
    return nodeDto(node, { canWrite: true });
  }

  @Post(':uploadId/abort')
  @HttpCode(204)
  async abort(@CurrentViewer() viewer: Viewer, @Param('uploadId') uploadId: string) {
    await this.uploads.abort(viewer, uploadId);
  }
}
