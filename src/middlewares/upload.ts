import multer from 'multer';
import { ApiError } from '../utils/ApiError';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
// Deployed on AWS API Gateway (REST API), which has a hard, non-configurable
// ~10MB request payload ceiling — a limit no application-level setting can
// raise. Keeping the worst case (MAX_FILE_SIZE_BYTES * MAX_FILES) safely
// under that, with headroom for multipart boundaries and other form
// fields, means an oversized upload fails fast with a clear 400 (see
// errorHandler's MulterError handling) instead of a confusing 413/timeout
// from API Gateway itself.
// Product listings want up to 10 images — 800KB/file keeps the worst case
// at 8MB, leaving ~2MB headroom under the ceiling for other form fields and
// multipart boundary overhead. Generous for a web-optimized product photo
// (a well-compressed JPEG/WebP at e-commerce dimensions is typically well
// under this), tight for an unedited phone photo — client-side compression
// before upload is expected.
const MAX_FILE_SIZE_BYTES = 800 * 1024; // 800KB
const MAX_FILES = 10;

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
