import { Category, CategoryDocument } from '../../models/Category';
import { Product } from '../../models/Product';
import { ApiError } from '../../utils/ApiError';
import { slugify } from '../../utils/slugify';
import { CreateCategoryInput, UpdateCategoryInput } from './category.validation';

async function generateUniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 1;
  for (;;) {
    const existing = await Category.findOne({
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

export async function createCategory(input: CreateCategoryInput): Promise<CategoryDocument> {
  if (input.parentCategory) {
    const parent = await Category.findById(input.parentCategory);
    if (!parent) {
      throw ApiError.badRequest('parentCategory does not exist');
    }
  }
  const slug = await generateUniqueSlug(input.name);
  return Category.create({
    name: input.name,
    slug,
    description: input.description,
    parentCategory: input.parentCategory ?? null,
  });
}

export async function updateCategory(
  id: string,
  input: UpdateCategoryInput,
): Promise<CategoryDocument> {
  const category = await Category.findById(id);
  if (!category) {
    throw ApiError.notFound('Category not found');
  }

  if (input.parentCategory !== undefined) {
    if (input.parentCategory === id) {
      throw ApiError.badRequest('A category cannot be its own parent');
    }
    if (input.parentCategory) {
      const parent = await Category.findById(input.parentCategory);
      if (!parent) {
        throw ApiError.badRequest('parentCategory does not exist');
      }
    }
    category.parentCategory = input.parentCategory as unknown as CategoryDocument['parentCategory'];
  }

  if (input.name !== undefined && input.name !== category.name) {
    category.name = input.name;
    category.slug = await generateUniqueSlug(input.name, id);
  }
  if (input.description !== undefined) {
    category.description = input.description;
  }
  if (input.isActive !== undefined) {
    category.isActive = input.isActive;
  }

  await category.save();
  return category;
}

export async function deleteCategory(id: string): Promise<void> {
  const category = await Category.findById(id);
  if (!category) {
    throw ApiError.notFound('Category not found');
  }

  const [productCount, childCount] = await Promise.all([
    Product.countDocuments({ category: id }),
    Category.countDocuments({ parentCategory: id }),
  ]);

  // Decision (documented in CLAUDE.md): deletion is BLOCKED, never cascaded,
  // when products or subcategories still reference this category. Admin
  // must reassign/delete dependents first — this avoids silently orphaning
  // or destroying catalog data.
  if (productCount > 0) {
    throw ApiError.conflict(
      `Cannot delete category with ${productCount} existing product(s). Reassign or remove them first.`,
    );
  }
  if (childCount > 0) {
    throw ApiError.conflict(
      `Cannot delete category with ${childCount} subcategory(ies). Remove them first.`,
    );
  }

  await category.deleteOne();
}

export async function listCategoriesFlat(): Promise<CategoryDocument[]> {
  return Category.find({ isActive: true }).sort({ name: 1 });
}

interface CategoryTreeNode {
  category: CategoryDocument;
  children: CategoryTreeNode[];
}

export async function listCategoriesTree(): Promise<CategoryTreeNode[]> {
  const all = await Category.find({ isActive: true }).sort({ name: 1 });
  const byParent = new Map<string, CategoryDocument[]>();
  for (const cat of all) {
    const key = cat.parentCategory ? cat.parentCategory.toString() : 'root';
    const bucket = byParent.get(key) ?? [];
    bucket.push(cat);
    byParent.set(key, bucket);
  }

  function build(parentKey: string): CategoryTreeNode[] {
    const children = byParent.get(parentKey) ?? [];
    return children.map((category) => ({
      category,
      children: build(category._id.toString()),
    }));
  }

  return build('root');
}
