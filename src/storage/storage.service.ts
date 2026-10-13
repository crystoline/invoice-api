import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { access, mkdir, writeFile } from 'fs/promises';
import { extname, resolve, sep } from 'path';

/** Raster images only — SVG can carry script, so it is never accepted. */
export const IMAGE_TYPES = ['.png', '.jpg', '.jpeg', '.gif', '.webp'] as const;
export const RECEIPT_TYPES = [...IMAGE_TYPES, '.pdf'] as const;

/**
 * Local-disk file storage — mirrors the legacy FileStorageService.
 * Files land under `${UPLOAD_DIR}/<subdirectory>/<uuid><ext>`. Only `logos/`
 * is served publicly (they appear on customer-facing invoices); everything
 * else, e.g. receipts, is served through authorized API routes.
 */
@Injectable()
export class StorageService {
  private readonly uploadDir: string;

  constructor(config: ConfigService) {
    this.uploadDir = config.get<string>('UPLOAD_DIR') ?? 'uploads';
  }

  /**
   * Store a file and return its path relative to the upload dir (e.g.
   * "receipts/<uuid>.pdf"). `allowed` lists the accepted extensions.
   */
  async storeFile(
    file: Express.Multer.File | undefined,
    subdirectory: string,
    allowed: readonly string[],
  ): Promise<string> {
    if (!file) throw new BadRequestException('No file uploaded');
    const ext = extname(file.originalname ?? '').toLowerCase();
    if (!allowed.includes(ext)) {
      throw new BadRequestException(
        `Unsupported file type. Allowed: ${allowed.join(', ')}`,
      );
    }
    // resolve(), not join(): UPLOAD_DIR may be absolute.
    const targetDir = resolve(process.cwd(), this.uploadDir, subdirectory);
    await mkdir(targetDir, { recursive: true });
    const storedName = `${randomUUID()}${ext}`;
    await writeFile(resolve(targetDir, storedName), file.buffer);
    return `${subdirectory}/${storedName}`;
  }

  /**
   * Absolute path of a stored file, which must live inside `subdirectory`
   * (no `..` escapes) and exist. 404 otherwise.
   */
  async resolveStored(
    relativePath: string,
    subdirectory: string,
  ): Promise<string> {
    const root = resolve(process.cwd(), this.uploadDir, subdirectory);
    const full = resolve(process.cwd(), this.uploadDir, relativePath);
    if (!full.startsWith(root + sep)) {
      throw new NotFoundException('File not found');
    }
    try {
      await access(full);
    } catch {
      throw new NotFoundException('File not found');
    }
    return full;
  }
}
