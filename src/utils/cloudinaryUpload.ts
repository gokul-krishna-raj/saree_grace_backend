import { UploadApiResponse } from 'cloudinary';
import { cloudinary } from '../config/cloudinary';
import { env } from '../config/env';

export interface UploadedImage {
  url: string;
  publicId: string;
  width: number;
  height: number;
}

/**
 * Uploads a memory buffer (from multer memoryStorage) directly to Cloudinary
 * via an upload stream — no temp file ever hits disk, which matters on
 * Lambda's read-only filesystem (except /tmp).
 */
export function uploadBufferToCloudinary(
  buffer: Buffer,
  options: { folder?: string } = {},
): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder ?? env.CLOUDINARY_UPLOAD_FOLDER,
        resource_type: 'image',
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Cloudinary upload failed'));
          return;
        }
        const uploaded = result as UploadApiResponse;
        resolve({
          url: uploaded.secure_url,
          publicId: uploaded.public_id,
          width: uploaded.width,
          height: uploaded.height,
        });
      },
    );
    stream.end(buffer);
  });
}

export async function deleteCloudinaryImage(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
}

export async function deleteCloudinaryImages(publicIds: string[]): Promise<void> {
  if (publicIds.length === 0) return;
  await Promise.all(publicIds.map((id) => deleteCloudinaryImage(id)));
}
