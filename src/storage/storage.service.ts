import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';

/**
 * Local-disk file storage — mirrors the legacy FileStorageService.
 * Files land under `${UPLOAD_DIR}/<subdirectory>/<uuid><ext>` and are served
 * publicly at `/uploads/**` (see ServeStaticModule in app.module).
 */
@Injectable()
export class StorageService {
  private readonly uploadDir: string;

  constructor(config: ConfigService) {
    this.uploadDir = config.get<string>('UPLOAD_DIR') ?? 'uploads';
  }

  /** Store a file and return its path relative to the upload dir (e.g. "receipts/<uuid>.pdf"). */
  async storeFile(file: Express.Multer.File, subdirectory: string): Promise<string> {
    const targetDir = join(process.cwd(), this.uploadDir, subdirectory);
    await mkdir(targetDir, { recursive: true });
    const ext = extname(file.originalname) || '';
    const storedName = `${randomUUID()}${ext}`;
    await writeFile(join(targetDir, storedName), file.buffer);
    return `${subdirectory}/${storedName}`;
  }
}
