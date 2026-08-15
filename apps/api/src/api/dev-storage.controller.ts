import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FILE_STORAGE } from '../application/ports/tokens';
import type { FileStorage } from '../application/ports/file-storage';
import { LocalFileStorage } from '../infra/storage/local-file-storage';
import { DomainError } from '../domain/errors';
import { Public } from './auth/viewer';

/**
 * Development-only object endpoint, active only when the FileStorage port is
 * bound to LocalFileStorage (i.e. Supabase is unconfigured). It exists so the
 * §7.1 upload handshake — browser PUTs straight to a signed URL — is genuinely
 * exercised locally rather than stubbed. In any deployment with SUPABASE_URL set,
 * these routes 404 because the storage adapter is not the local one.
 */
@Controller('dev-storage')
export class DevStorageController {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  private local(): LocalFileStorage {
    if (!(this.storage instanceof LocalFileStorage)) throw DomainError.notFound('Object');
    return this.storage;
  }

  @Public()
  @Put(':key')
  @HttpCode(200)
  async put(@Param('key') key: string, @Req() request: Request) {
    const local = this.local();
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);

    local.put(
      key,
      Buffer.concat(chunks),
      (request.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim(),
    );
    return { ok: true };
  }

  @Public()
  @Get(':key')
  get(
    @Param('key') key: string,
    @Res() response: Response,
    @Query('disposition') disposition?: string,
    @Query('filename') filename?: string,
  ) {
    const object = this.local().read(key);
    if (!object) throw DomainError.notFound('Object');

    response.setHeader('content-type', object.contentType);
    response.setHeader(
      'content-disposition',
      `${disposition === 'attachment' ? 'attachment' : 'inline'}; filename="${(filename ?? key).replace(/"/g, '')}"`,
    );
    response.send(object.body);
  }
}
