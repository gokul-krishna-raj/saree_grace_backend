import multer from 'multer';
import { ApiError } from '../utils/ApiError';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 8;

/**
 * Memory storage only — buffers are streamed straight to Cloudinary and
 * never touch disk, which matters on Lambda's read-only filesystem.
 * MIME type is checked here from the multipart field (not trusted alone —
 * Cloudinary re-validates the actual bytes on upload) and again by magic
 * bytes is out of scope for a first pass but size + declared type are.
 */
const storage = multer.memoryStorage();

function fileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: multer.FileFilterCallback,
): void {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    callback(ApiError.badRequest(`Unsupported file type: ${file.mimetype}`));
    return;
  }
  callback(null, true);
}

export const uploadImages = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: MAX_FILES,
  },
});
