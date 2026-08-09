import { Occasion, OccasionDocument } from '../../models/Occasion';
import { Product } from '../../models/Product';
import { ApiError } from '../../utils/ApiError';
import { slugify } from '../../utils/slugify';
import { uploadBufferToCloudinary, deleteCloudinaryImage } from '../../utils/cloudinaryUpload';
import { CreateOccasionInput, UpdateOccasionInput } from './occasion.validation';

async function generateUniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 1;
  for (;;) {
    const existing = await Occasion.findOne({
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });
    if (!existing) {
      return candidate;
    }
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

export async function createOccasion(
  input: CreateOccasionInput,
  file?: Express.Multer.File,
): Promise<OccasionDocument> {
  const slug = await generateUniqueSlug(input.name);
  const image = file ? await uploadBufferToCloudinary(file.buffer) : undefined;

  return Occasion.create({
    name: input.name,
    slug,
    description: input.description,
    image: image ? { url: image.url, publicId: image.publicId } : undefined,
  });
}

export async function updateOccasion(
  id: string,
  input: UpdateOccasionInput,
  file?: Express.Multer.File,
): Promise<OccasionDocument> {
  const occasion = await Occasion.findById(id);
  if (!occasion) {
    throw ApiError.notFound('Occasion not found');
  }

  if (input.name !== undefined && input.name !== occasion.name) {
    occasion.name = input.name;
    occasion.slug = await generateUniqueSlug(input.name, id);
  }
  if (input.description !== undefined) {
    occasion.description = input.description;
  }
  if (input.isActive !== undefined) {
    occasion.isActive = input.isActive;
  }

  if (file) {
    if (occasion.image) {
      await deleteCloudinaryImage(occasion.image.publicId);
    }
    const uploaded = await uploadBufferToCloudinary(file.buffer);
    occasion.image = { url: uploaded.url, publicId: uploaded.publicId };
  } else if (input.removeImage && occasion.image) {
    await deleteCloudinaryImage(occasion.image.publicId);
    occasion.image = undefined;
  }

  await occasion.save();
  return occasion;
}

export async function deleteOccasion(id: string): Promise<void> {
  const occasion = await Occasion.findById(id);
  if (!occasion) {
    throw ApiError.notFound('Occasion not found');
  }

  const productCount = await Product.countDocuments({ occasions: id });
  // Same decision as category deletion (see CLAUDE.md): block rather than
  // cascade, so removing an occasion tag can never silently strip it off
  // products or delete catalog data as a side effect of cleanup.
  if (productCount > 0) {
    throw ApiError.conflict(
      `Cannot delete occasion with ${productCount} existing product(s). Reassign or remove them first.`,
    );
  }

  if (occasion.image) {
    await deleteCloudinaryImage(occasion.image.publicId);
  }
  await occasion.deleteOne();
}

export async function listOccasionsFlat(): Promise<OccasionDocument[]> {
  return Occasion.find({ isActive: true }).sort({ name: 1 });
}
