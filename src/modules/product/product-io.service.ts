import { Types } from 'mongoose';
import { Category } from '../../models/Category';
import { Occasion } from '../../models/Occasion';
import {
  LoomType,
  Product,
  ProductDocument,
  ProductImage,
  ProductType,
  ProductVariant,
} from '../../models/Product';
import { ApiError } from '../../utils/ApiError';
import { uploadRemoteImageToCloudinary } from '../../utils/cloudinaryUpload';
import {
  CsvCell,
  CsvParseError,
  isBlankRow,
  parseCsv,
  serializeCsv,
  unescapeFormula,
} from '../../utils/csv';
import { logger } from '../../utils/logger';
import { slugify } from '../../utils/slugify';
import { generateUniqueProductSlug } from './product.service';

/**
 * Bulk product CSV export/import. One row per sellable SKU: a simple
 * product is one row, a variant product is one row per variant sharing the
 * same `handle` (= slug, the match key). See CLAUDE.md "Bulk product CSV
 * import/export" for the rules; the short version:
 *
 * - Preview and commit share planGroup(), which applies a group of rows onto
 *   a Product document *in memory* and reports changes/warnings/errors.
 *   Preview throws the mutated documents away; commit re-reads each product
 *   immediately before applying, so it never saves stale data.
 * - A blank cell keeps the current value. Nothing is ever deleted (products,
 *   variants or Cloudinary images) — hiding is done via the *Active columns.
 * - Writes go through save() so the sortPrice pre-save hook runs.
 */

export const IMPORT_COLUMNS = [
  'handle',
  'name',
  'type',
  'category',
  'occasions',
  'fabric',
  'color',
  'loomType',
  'description',
  'seoTitle',
  'seoDescription',
  'productActive',
  'variantAttributeNames',
  'sku',
  'attributes',
  'price',
  'compareAtPrice',
  'stock',
  'variantActive',
  'images',
] as const;

type Column = (typeof IMPORT_COLUMNS)[number];

const REQUIRED_COLUMNS: Column[] = ['handle', 'name', 'type', 'sku', 'price', 'stock'];

const PRODUCT_COLUMNS: Column[] = [
  'name',
  'type',
  'category',
  'occasions',
  'fabric',
  'color',
  'loomType',
  'description',
  'seoTitle',
  'seoDescription',
  'productActive',
  'variantAttributeNames',
];

const VARIANT_COLUMNS: Column[] = [
  'sku',
  'attributes',
  'price',
  'compareAtPrice',
  'stock',
  'variantActive',
  'images',
];

// Compared case-insensitively when the same product column is repeated on
// a later row of a variant product.
const CASE_INSENSITIVE_COLUMNS = new Set<Column>(['type', 'category', 'occasions', 'loomType']);

export const MAX_IMPORT_ROWS = 2000;
const MAX_IMAGES_PER_ROW = 10;
const REMOTE_UPLOAD_CONCURRENCY = 4;
// Lambda's function timeout is 25s; stop starting new products well before.
const COMMIT_TIME_BUDGET_MS = 20_000;
// Marks an image whose URL is new to the product — replaced with the real
// Cloudinary URL/publicId at commit, never saved as-is.
const PENDING_PUBLIC_ID = '__pending_import_upload__';

// Mirrors the limits in product.validation.ts.
const TEXT_LIMITS = {
  name: { min: 2, max: 200 },
  description: { min: 1, max: 5000 },
  fabric: { min: 0, max: 100 },
  color: { min: 0, max: 100 },
  seoTitle: { min: 0, max: 100 },
  seoDescription: { min: 0, max: 300 },
} as const;

const HANDLE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const LOOM_TYPES: LoomType[] = ['handloom', 'powerloom', 'unknown'];
const TRUE_VALUES = new Set(['true', 'yes', '1']);
const FALSE_VALUES = new Set(['false', 'no', '0']);

export type ImportAction = 'create' | 'update' | 'unchanged' | 'error';

export interface ImportProductPlan {
  key: string;
  handle: string;
  name: string;
  type: ProductType | '';
  action: ImportAction;
  rows: number[];
  changes: string[];
  warnings: string[];
  errors: string[];
}

export interface ImportPreview {
  summary: {
    products: number;
    create: number;
    update: number;
    unchanged: number;
    error: number;
  };
  products: ImportProductPlan[];
}

export type CommitStatus = 'created' | 'updated' | 'unchanged' | 'failed' | 'skipped';

export interface ImportCommitResult {
  key: string;
  status: CommitStatus;
  slug?: string;
  error?: string;
}

interface CsvRow {
  rowNumber: number;
  cells: Record<Column, string>;
}

interface RowGroup {
  key: string;
  handle: string;
  rows: [CsvRow, ...CsvRow[]];
}

interface RefLookup {
  bySlug: Map<string, string>;
  byName: Map<string, string[]>;
  names: Map<string, string>;
}

interface ImportContext {
  categories: RefLookup;
  occasions: RefLookup;
  productsBySlug: Map<string, ProductDocument>;
  productsBySimpleSku: Map<string, ProductDocument>;
  skuOwners: Map<string, { productId: string; slug: string }>;
  /** SKU → every row number it appears on, in file order. */
  fileSkuRows: Map<string, number[]>;
}

// ---------------------------------------------------------------------------
// CSV → row groups
// ---------------------------------------------------------------------------

function normaliseHeader(raw: string): string {
  return unescapeFormula(raw.trim()).replace(/\s+/g, '').toLowerCase();
}

function cleanCell(raw: string): string {
  return unescapeFormula(raw.trim()).replace(/\r\n?/g, '\n');
}

function readRows(csv: string): CsvRow[] {
  let records: string[][];
  try {
    records = parseCsv(csv);
  } catch (err) {
    if (err instanceof CsvParseError) throw ApiError.badRequest(err.message);
    throw err;
  }

  const [header, ...body] = records;
  if (!header || isBlankRow(header)) {
    throw ApiError.badRequest('The CSV file is empty');
  }

  const columnIndex = new Map<Column, number>();
  header.forEach((raw, index) => {
    const normalised = normaliseHeader(raw);
    const column = IMPORT_COLUMNS.find((c) => c.toLowerCase() === normalised);
    if (!column) return;
    if (columnIndex.has(column)) {
      throw ApiError.badRequest(`The column "${column}" appears more than once in the header row`);
    }
    columnIndex.set(column, index);
  });

  const missing = REQUIRED_COLUMNS.filter((column) => !columnIndex.has(column));
  if (missing.length > 0) {
    throw ApiError.badRequest(
      `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
        'The first row must be the header row of a comma-separated file — download the template to see the expected columns.',
      { missingColumns: missing },
    );
  }

  const rows: CsvRow[] = [];
  body.forEach((record, index) => {
    if (isBlankRow(record)) return;
    const cells = {} as Record<Column, string>;
    for (const column of IMPORT_COLUMNS) {
      const position = columnIndex.get(column);
      cells[column] = position === undefined ? '' : cleanCell(record[position] ?? '');
    }
    // Header is row 1, so the first data record is row 2 — the number a
    // spreadsheet shows next to it.
    rows.push({ rowNumber: index + 2, cells });
  });

  if (rows.length === 0) {
    throw ApiError.badRequest('The CSV file has a header row but no products');
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw ApiError.badRequest(
      `The CSV file has ${rows.length} rows — the limit is ${MAX_IMPORT_ROWS} per file. Split it into smaller files.`,
    );
  }
  return rows;
}

function groupRows(rows: CsvRow[]): RowGroup[] {
  const groups = new Map<string, RowGroup>();
  for (const row of rows) {
    const handle = row.cells.handle.toLowerCase();
    const sku = row.cells.sku.toUpperCase();
    // Never matched by name: no handle falls back to SKU (simple products),
    // and a row with neither is always its own new product.
    const key = handle ? `handle:${handle}` : sku ? `sku:${sku}` : `row:${row.rowNumber}`;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, { key, handle, rows: [row] });
    }
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Context: everything planning needs, loaded once (no per-row queries)
// ---------------------------------------------------------------------------

function buildRefLookup(
  docs: Array<{ _id: Types.ObjectId; name: string; slug: string }>,
): RefLookup {
  const lookup: RefLookup = { bySlug: new Map(), byName: new Map(), names: new Map() };
  for (const doc of docs) {
    const id = doc._id.toString();
    lookup.bySlug.set(doc.slug.toLowerCase(), id);
    const nameKey = doc.name.trim().toLowerCase();
    lookup.byName.set(nameKey, [...(lookup.byName.get(nameKey) ?? []), id]);
    lookup.names.set(id, doc.name);
  }
  return lookup;
}

function resolveRef(lookup: RefLookup, value: string): { id?: string; error?: string } {
  const key = value.trim().toLowerCase();
  const bySlug = lookup.bySlug.get(key);
  if (bySlug) return { id: bySlug };
  const byName = lookup.byName.get(key) ?? [];
  if (byName.length === 1) return { id: byName[0] };
  if (byName.length > 1) return { error: 'matches more than one by name — use the slug instead' };
  return { error: 'does not exist' };
}

async function loadContext(rows: CsvRow[], groups: RowGroup[]): Promise<ImportContext> {
  const handles = [...new Set(groups.map((g) => g.handle).filter(Boolean))];
  const fileSkuRows = new Map<string, number[]>();
  for (const row of rows) {
    const sku = row.cells.sku.toUpperCase();
    if (!sku) continue;
    fileSkuRows.set(sku, [...(fileSkuRows.get(sku) ?? []), row.rowNumber]);
  }
  const skus = [...fileSkuRows.keys()];

  const [categories, occasions, products] = await Promise.all([
    Category.find({}, 'name slug').lean(),
    Occasion.find({}, 'name slug').lean(),
    Product.find({
      $or: [{ slug: { $in: handles } }, { sku: { $in: skus } }, { 'variants.sku': { $in: skus } }],
    }),
  ]);

  const ctx: ImportContext = {
    categories: buildRefLookup(categories),
    occasions: buildRefLookup(occasions),
    productsBySlug: new Map(),
    productsBySimpleSku: new Map(),
    skuOwners: new Map(),
    fileSkuRows,
  };
  for (const product of products) {
    const owner = { productId: product._id.toString(), slug: product.slug };
    ctx.productsBySlug.set(product.slug, product);
    if (product.sku) {
      ctx.productsBySimpleSku.set(product.sku, product);
      ctx.skuOwners.set(product.sku, owner);
    }
    for (const variant of product.variants) {
      ctx.skuOwners.set(variant.sku, owner);
    }
  }
  return ctx;
}

function locateExisting(
  group: RowGroup,
  ctx: ImportContext,
): { existing: ProductDocument | null; error?: string } {
  if (group.handle) {
    return { existing: ctx.productsBySlug.get(group.handle) ?? null };
  }
  const sku = group.rows[0].cells.sku.toUpperCase();
  if (sku) {
    const simple = ctx.productsBySimpleSku.get(sku);
    if (simple) return { existing: simple };
    const owner = ctx.skuOwners.get(sku);
    if (owner) {
      return {
        existing: null,
        error: `SKU ${sku} is a variant of "${owner.slug}" — set handle to ${owner.slug} to update it`,
      };
    }
  }
  return { existing: null };
}

// ---------------------------------------------------------------------------
// Cell parsers
// ---------------------------------------------------------------------------

function truncate(value: string, max = 40): string {
  const oneLine = value.replace(/\s+/g, ' ');
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** Accepts "₹2,499", "2499", "Rs 2499", "Rs. 2,499.50". Returns null if not a number. */
function parseAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/^(₹|rs\.?|inr)\s*/i, '')
    .replace(/,/g, '')
    .trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseStockValue(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

function parseBool(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  return null;
}

function splitList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split('|')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

function parseAttributes(raw: string): { value?: Record<string, string>; error?: string } {
  const result: Record<string, string> = {};
  for (const part of raw.split('|')) {
    const pair = part.trim();
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      return {
        error: `attribute "${truncate(pair)}" must look like name=value (e.g. color=Maroon)`,
      };
    }
    let key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key.toLowerCase() === 'colorcode') key = 'colorCode';
    if (key.startsWith('$') || key.includes('.')) {
      return { error: `attribute name "${truncate(key)}" may not start with $ or contain a dot` };
    }
    if (key in result) {
      return { error: `attribute "${key}" is listed twice` };
    }
    if (!value) {
      // An empty colorCode means "no swatch", same as the admin API.
      if (key === 'colorCode') continue;
      return { error: `attribute "${key}" has no value` };
    }
    if (key === 'colorCode' && !HEX_COLOR_RE.test(value)) {
      return { error: `colorCode "${truncate(value)}" must be a hex colour like #800000` };
    }
    result[key] = value;
  }
  if (Object.keys(result).length === 0) {
    return { error: 'attributes must have at least one name=value pair' };
  }
  return { value: result };
}

function parseImageUrls(raw: string): { value?: string[]; error?: string } {
  const urls = splitList(raw);
  if (urls.length > MAX_IMAGES_PER_ROW) {
    return { error: `${urls.length} images — at most ${MAX_IMAGES_PER_ROW} per row` };
  }
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: `image "${truncate(url, 60)}" is not a valid URL` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: `image "${truncate(url, 60)}" must be an http(s) URL` };
    }
  }
  return { value: urls };
}

// ---------------------------------------------------------------------------
// Comparison / formatting helpers
// ---------------------------------------------------------------------------

function attributeEntries(attributes: Map<string, string> | Record<string, string> | undefined) {
  if (!attributes) return [] as Array<[string, string]>;
  return attributes instanceof Map
    ? [...attributes.entries()]
    : Object.entries(attributes as Record<string, string>);
}

function formatAttributes(attributes: Map<string, string> | Record<string, string>): string {
  return attributeEntries(attributes)
    .map(([key, value]) => `${key}=${value}`)
    .join('|');
}

function attributesEqual(current: Map<string, string>, next: Record<string, string>): boolean {
  const nextEntries = Object.entries(next);
  return current.size === nextEntries.length && nextEntries.every(([k, v]) => current.get(k) === v);
}

/** Variants that differ only by colorCode (or case) look identical to a shopper. */
function attributeSignature(attributes: Map<string, string>): string {
  return attributeEntries(attributes)
    .filter(([key]) => key.toLowerCase() !== 'colorcode')
    .map(([key, value]) => `${key.toLowerCase()}=${value.trim().toLowerCase()}`)
    .sort()
    .join('&');
}

const formatPrice = (value: number | undefined | null) =>
  value === undefined || value === null ? '(none)' : `₹${value}`;
const formatText = (value: string | undefined | null) =>
  value ? `"${truncate(value)}"` : '(blank)';
const formatBool = (value: boolean) => (value ? 'active' : 'hidden');

function normaliseText(value: string | undefined | null): string {
  return (value ?? '').replace(/\r\n?/g, '\n').trim();
}

function sameIds(a: Types.ObjectId[], b: string[]): boolean {
  const left = a.map((id) => id.toString()).sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

function imageList(images: ProductImage[], urls: string[], known: Map<string, ProductImage>) {
  const currentUrls = images.map((img) => img.url);
  if (currentUrls.length === urls.length && currentUrls.every((url, i) => url === urls[i])) {
    return null;
  }
  const added = urls.filter((url) => !currentUrls.includes(url)).length;
  const removed = currentUrls.filter((url) => !urls.includes(url)).length;
  const parts = [];
  if (added > 0) parts.push(`${added} new`);
  if (removed > 0) parts.push(`${removed} removed`);
  const next: ProductImage[] = urls.map((url, index) => {
    const existing = known.get(url);
    return {
      url,
      publicId: existing ? existing.publicId : PENDING_PUBLIC_ID,
      isPrimary: index === 0,
    };
  });
  return { images: next, summary: parts.length > 0 ? parts.join(', ') : 'reordered' };
}

// ---------------------------------------------------------------------------
// Planning a single product
// ---------------------------------------------------------------------------

interface PlanOutcome {
  plan: ImportProductPlan;
  doc: ProductDocument | null;
}

function planGroup(
  group: RowGroup,
  existing: ProductDocument | null,
  ctx: ImportContext,
): PlanOutcome {
  const firstRow = group.rows[0];
  const errors: string[] = [];
  const warnings: string[] = [];
  const changes: string[] = [];
  const isNew = existing === null;
  const rowError = (row: number, message: string) => errors.push(`Row ${row}: ${message}`);

  const plan = (doc: ProductDocument | null, type: ProductType | ''): PlanOutcome => {
    const action: ImportAction =
      errors.length > 0 ? 'error' : isNew ? 'create' : changes.length > 0 ? 'update' : 'unchanged';
    return {
      plan: {
        key: group.key,
        handle: existing?.slug ?? group.handle,
        name: doc?.name || firstRow.cells.name || existing?.name || '',
        type,
        action,
        rows: group.rows.map((r) => r.rowNumber),
        changes,
        warnings,
        errors,
      },
      doc: errors.length > 0 ? null : doc,
    };
  };

  // Product-level columns: the first non-blank value wins; a *different*
  // non-blank value on a later row is ambiguous, so it's an error.
  const productCells = new Map<Column, { value: string; row: number }>();
  for (const column of PRODUCT_COLUMNS) {
    for (const row of group.rows) {
      const value = row.cells[column];
      if (!value) continue;
      const first = productCells.get(column);
      if (!first) {
        productCells.set(column, { value, row: row.rowNumber });
        continue;
      }
      const same =
        column === 'productActive'
          ? parseBool(first.value) === parseBool(value)
          : CASE_INSENSITIVE_COLUMNS.has(column)
            ? first.value.toLowerCase() === value.toLowerCase()
            : first.value === value;
      if (!same) {
        rowError(
          row.rowNumber,
          `${column} "${truncate(value)}" differs from row ${first.row} — product columns only need to be filled on the first row`,
        );
      }
    }
  }
  const cell = (column: Column) => productCells.get(column);

  const located = existing ? null : locateExisting(group, ctx);
  if (located?.error) rowError(firstRow.rowNumber, located.error);

  // --- type ---------------------------------------------------------------
  const typeCell = cell('type');
  const typeValue = typeCell?.value.toLowerCase();
  if (typeValue && typeValue !== 'simple' && typeValue !== 'variant') {
    rowError(typeCell!.row, `type must be "simple" or "variant", not "${truncate(typeValue)}"`);
  }
  let type: ProductType | undefined;
  if (existing) {
    type = existing.type;
    if ((typeValue === 'simple' || typeValue === 'variant') && typeValue !== existing.type) {
      rowError(
        typeCell!.row,
        `type can't be changed from ${existing.type} to ${typeValue} — create a new product with a different handle instead`,
      );
    }
  } else if (typeValue === 'simple' || typeValue === 'variant') {
    type = typeValue;
  } else if (!typeValue) {
    rowError(firstRow.rowNumber, 'type is required for a new product (simple or variant)');
  }
  if (!type) return plan(null, '');

  if (isNew && group.handle && !HANDLE_RE.test(group.handle)) {
    rowError(
      firstRow.rowNumber,
      `handle "${truncate(group.handle)}" may only contain lowercase letters, numbers and single hyphens`,
    );
  }
  if (isNew && type === 'variant' && !group.handle) {
    rowError(firstRow.rowNumber, 'a new variant product needs a handle so its rows can be grouped');
  }

  const doc =
    existing ??
    new Product({
      type,
      slug: group.handle || 'pending-slug',
      variants: [],
      images: [],
      occasions: [],
    });

  // Every image currently on the product, by URL — reused as-is (no
  // re-upload) wherever the file lists it.
  const knownImages = new Map<string, ProductImage>();
  for (const img of [...doc.images, ...doc.variants.flatMap((v) => v.images)]) {
    knownImages.set(img.url, { url: img.url, publicId: img.publicId });
  }

  // --- product-level fields ------------------------------------------------
  const textField = (column: keyof typeof TEXT_LIMITS): string | undefined => {
    const entry = cell(column);
    if (!entry) return undefined;
    const value = normaliseText(entry.value);
    const { min, max } = TEXT_LIMITS[column];
    if (value.length < min || value.length > max) {
      rowError(
        entry.row,
        min > 1
          ? `${column} must be ${min}–${max} characters (it has ${value.length})`
          : `${column} must be at most ${max} characters (it has ${value.length})`,
      );
      return undefined;
    }
    return value;
  };

  const name = textField('name');
  if (name !== undefined && name !== doc.name) {
    if (!isNew) changes.push(`name: ${formatText(doc.name)} → ${formatText(name)}`);
    doc.name = name;
  }
  const description = textField('description');
  if (description !== undefined && description !== normaliseText(doc.description)) {
    if (!isNew) changes.push('description updated');
    doc.description = description;
  }
  for (const column of ['fabric', 'color', 'seoTitle', 'seoDescription'] as const) {
    const value = textField(column);
    if (value !== undefined && value !== normaliseText(doc[column])) {
      if (!isNew) changes.push(`${column}: ${formatText(doc[column])} → ${formatText(value)}`);
      doc[column] = value;
    }
  }

  const categoryCell = cell('category');
  if (categoryCell) {
    const resolved = resolveRef(ctx.categories, categoryCell.value);
    if (!resolved.id) {
      rowError(categoryCell.row, `category "${truncate(categoryCell.value)}" ${resolved.error}`);
    } else if (doc.category?.toString() !== resolved.id) {
      if (!isNew) {
        const before = doc.category ? ctx.categories.names.get(doc.category.toString()) : undefined;
        changes.push(
          `category: ${before ?? '(none)'} → ${ctx.categories.names.get(resolved.id) ?? resolved.id}`,
        );
      }
      doc.category = new Types.ObjectId(resolved.id);
    }
  }

  const occasionsCell = cell('occasions');
  if (occasionsCell) {
    const ids: string[] = [];
    for (const value of splitList(occasionsCell.value)) {
      const resolved = resolveRef(ctx.occasions, value);
      if (resolved.id) {
        if (!ids.includes(resolved.id)) ids.push(resolved.id);
      } else {
        rowError(occasionsCell.row, `occasion "${truncate(value)}" ${resolved.error}`);
      }
    }
    if (ids.length > 0 && !sameIds(doc.occasions, ids)) {
      if (!isNew) {
        const names = (list: string[]) =>
          list.map((id) => ctx.occasions.names.get(id) ?? id).join(', ') || '(none)';
        changes.push(
          `occasions: ${names(doc.occasions.map((id) => id.toString()))} → ${names(ids)}`,
        );
      }
      doc.occasions = ids.map((id) => new Types.ObjectId(id));
    }
  }

  const loomCell = cell('loomType');
  if (loomCell) {
    const value = loomCell.value.toLowerCase() as LoomType;
    if (!LOOM_TYPES.includes(value)) {
      rowError(
        loomCell.row,
        `loomType must be handloom, powerloom or unknown, not "${truncate(loomCell.value)}"`,
      );
    } else if (value !== doc.loomType) {
      if (!isNew) changes.push(`loomType: ${doc.loomType} → ${value}`);
      doc.loomType = value;
    }
  }

  const activeCell = cell('productActive');
  if (activeCell) {
    const value = parseBool(activeCell.value);
    if (value === null) {
      rowError(
        activeCell.row,
        `productActive must be TRUE or FALSE, not "${truncate(activeCell.value)}"`,
      );
    } else if (value !== doc.isActive) {
      if (!isNew) changes.push(`status: ${formatBool(doc.isActive)} → ${formatBool(value)}`);
      doc.isActive = value;
    }
  }

  if (isNew) {
    if (!doc.name) rowError(firstRow.rowNumber, 'name is required for a new product');
    if (!doc.description) rowError(firstRow.rowNumber, 'description is required for a new product');
    if (!doc.category) rowError(firstRow.rowNumber, 'category is required for a new product');
  }

  // --- variant-level cells -------------------------------------------------
  interface ParsedVariantCells {
    sku?: string;
    attributes?: Record<string, string>;
    price?: number;
    compareAtPrice?: number | null; // null = clear (0 in the file)
    stock?: number;
    active?: boolean;
    images?: string[];
  }

  const parseVariantCells = (row: CsvRow): ParsedVariantCells | null => {
    const c = row.cells;
    const before = errors.length;
    const parsed: ParsedVariantCells = {};
    if (c.sku) parsed.sku = c.sku.toUpperCase();
    if (c.price) {
      const value = parseAmount(c.price);
      if (value === null)
        rowError(row.rowNumber, `price "${truncate(c.price)}" is not a valid amount`);
      else if (value <= 0) rowError(row.rowNumber, 'price must be greater than 0');
      else parsed.price = value;
    }
    if (c.compareAtPrice) {
      const value = parseAmount(c.compareAtPrice);
      if (value === null) {
        rowError(
          row.rowNumber,
          `compareAtPrice "${truncate(c.compareAtPrice)}" is not a valid amount`,
        );
      } else {
        parsed.compareAtPrice = value === 0 ? null : value;
      }
    }
    if (c.stock) {
      const value = parseStockValue(c.stock);
      if (value === null) {
        rowError(row.rowNumber, `stock "${truncate(c.stock)}" must be a whole number of 0 or more`);
      } else {
        parsed.stock = value;
      }
    }
    if (c.images) {
      const result = parseImageUrls(c.images);
      if (result.error) rowError(row.rowNumber, result.error);
      else parsed.images = result.value;
    }
    if (type === 'variant') {
      if (c.attributes) {
        const result = parseAttributes(c.attributes);
        if (result.error) rowError(row.rowNumber, result.error);
        else parsed.attributes = result.value;
      }
      if (c.variantActive) {
        const value = parseBool(c.variantActive);
        if (value === null) {
          rowError(
            row.rowNumber,
            `variantActive must be TRUE or FALSE, not "${truncate(c.variantActive)}"`,
          );
        } else {
          parsed.active = value;
        }
      }
    }
    return errors.length > before ? null : parsed;
  };

  // A SKU may appear once in the whole file and must not belong to another product.
  const skuProblem = (row: CsvRow, sku: string): string | null => {
    const rowsWithSku = ctx.fileSkuRows.get(sku) ?? [];
    const firstOccurrence = rowsWithSku[0];
    if (firstOccurrence !== undefined && firstOccurrence !== row.rowNumber) {
      return `SKU ${sku} is also used on row ${firstOccurrence} — every SKU must be unique`;
    }
    const owner = ctx.skuOwners.get(sku);
    if (owner && owner.productId !== doc._id.toString()) {
      return `SKU ${sku} already belongs to another product ("${owner.slug}")`;
    }
    return null;
  };

  const compareWarning = (label: string, price?: number, compareAt?: number) => {
    if (price !== undefined && compareAt !== undefined && compareAt < price) {
      warnings.push(
        `${label}compareAtPrice ${formatPrice(compareAt)} is lower than price ${formatPrice(price)}`,
      );
    }
  };

  if (type === 'simple') {
    if (group.rows.length > 1) {
      rowError(
        group.rows[1]!.rowNumber,
        `a simple product must be a single row, but "${group.handle || firstRow.cells.sku}" spans rows ${group.rows.map((r) => r.rowNumber).join(', ')}`,
      );
    }
    const c = firstRow.cells;
    if (c.attributes)
      warnings.push(`Row ${firstRow.rowNumber}: attributes are ignored for a simple product`);
    if (c.variantActive)
      warnings.push(
        `Row ${firstRow.rowNumber}: variantActive is ignored for a simple product — use productActive`,
      );
    if (cell('variantAttributeNames')) {
      warnings.push(
        `Row ${firstRow.rowNumber}: variantAttributeNames is ignored for a simple product`,
      );
    }

    const parsed = parseVariantCells(firstRow);
    if (parsed) {
      if (parsed.sku) {
        const problem = skuProblem(firstRow, parsed.sku);
        if (problem) rowError(firstRow.rowNumber, problem);
        else if (parsed.sku !== doc.sku) {
          if (!isNew) changes.push(`sku: ${doc.sku ?? '(none)'} → ${parsed.sku}`);
          doc.sku = parsed.sku;
        }
      }
      if (parsed.price !== undefined && parsed.price !== doc.price) {
        if (!isNew) changes.push(`price: ${formatPrice(doc.price)} → ${formatPrice(parsed.price)}`);
        doc.price = parsed.price;
      }
      if (parsed.compareAtPrice !== undefined) {
        const next = parsed.compareAtPrice ?? undefined;
        if (next !== (doc.compareAtPrice ?? undefined)) {
          if (!isNew) {
            changes.push(
              `compareAtPrice: ${formatPrice(doc.compareAtPrice)} → ${formatPrice(next)}`,
            );
          }
          doc.compareAtPrice = next;
        }
      }
      if (parsed.stock !== undefined && parsed.stock !== doc.stock) {
        if (!isNew) changes.push(`stock: ${doc.stock ?? 0} → ${parsed.stock}`);
        doc.stock = parsed.stock;
      }
      if (parsed.images) {
        const next = imageList(doc.images, parsed.images, knownImages);
        if (next) {
          if (!isNew) changes.push(`images: ${next.summary}`);
          doc.images = next.images;
        }
      }
      if (isNew) {
        if (doc.price === undefined)
          rowError(firstRow.rowNumber, 'price is required for a new product');
        if (parsed.stock === undefined)
          rowError(firstRow.rowNumber, 'stock is required for a new product');
        if (doc.images.length === 0)
          warnings.push('No images — add image URLs so the product has photos');
      }
      if (parsed.price !== undefined || parsed.compareAtPrice !== undefined) {
        compareWarning('', doc.price, doc.compareAtPrice);
      }
    }
    if (isNew) changes.unshift('new simple product');
    return plan(doc, type);
  }

  // --- variant product ------------------------------------------------------
  const namesCell = cell('variantAttributeNames');
  if (namesCell) {
    const names = splitList(namesCell.value);
    if (names.length > 0 && names.join('|') !== doc.variantAttributeNames.join('|')) {
      if (!isNew) {
        changes.push(
          `variantAttributeNames: ${doc.variantAttributeNames.join('|') || '(none)'} → ${names.join('|')}`,
        );
      }
      doc.variantAttributeNames = names;
    }
  }

  const skuRows = new Map<string, number>();
  for (const row of group.rows) {
    const c = row.cells;
    // A row with no variant cells only carries product-level columns.
    if (VARIANT_COLUMNS.every((column) => !c[column])) continue;
    if (!c.sku) {
      rowError(row.rowNumber, 'sku is required on every variant row');
      continue;
    }
    const parsed = parseVariantCells(row);
    if (!parsed || !parsed.sku) continue;
    const sku = parsed.sku;
    const problem = skuProblem(row, sku);
    if (problem) {
      rowError(row.rowNumber, problem);
      continue;
    }
    skuRows.set(sku, row.rowNumber);
    const variant = doc.variants.find((v) => v.sku === sku);

    if (!variant) {
      const missing = [
        parsed.attributes ? null : 'attributes',
        parsed.price !== undefined ? null : 'price',
        parsed.stock !== undefined ? null : 'stock',
      ].filter(Boolean);
      if (missing.length > 0) {
        rowError(row.rowNumber, `new variant ${sku} needs ${missing.join(', ')}`);
        continue;
      }
      const images = parsed.images ? (imageList([], parsed.images, knownImages)?.images ?? []) : [];
      doc.variants.push({
        _id: new Types.ObjectId(),
        sku,
        attributes: new Map(Object.entries(parsed.attributes!)),
        price: parsed.price!,
        compareAtPrice: parsed.compareAtPrice ?? undefined,
        stock: parsed.stock!,
        images,
        isActive: parsed.active ?? true,
      } as ProductVariant);
      changes.push(`new variant ${sku}`);
      compareWarning(`${sku} `, parsed.price, parsed.compareAtPrice ?? undefined);
      continue;
    }

    if (parsed.attributes && !attributesEqual(variant.attributes, parsed.attributes)) {
      changes.push(
        `${sku} attributes: ${formatAttributes(variant.attributes)} → ${formatAttributes(parsed.attributes)}`,
      );
      variant.attributes = new Map(Object.entries(parsed.attributes));
    }
    if (parsed.price !== undefined && parsed.price !== variant.price) {
      changes.push(`${sku} price: ${formatPrice(variant.price)} → ${formatPrice(parsed.price)}`);
      variant.price = parsed.price;
    }
    if (parsed.compareAtPrice !== undefined) {
      const next = parsed.compareAtPrice ?? undefined;
      if (next !== (variant.compareAtPrice ?? undefined)) {
        changes.push(
          `${sku} compareAtPrice: ${formatPrice(variant.compareAtPrice)} → ${formatPrice(next)}`,
        );
        variant.compareAtPrice = next;
      }
    }
    if (parsed.stock !== undefined && parsed.stock !== variant.stock) {
      changes.push(`${sku} stock: ${variant.stock} → ${parsed.stock}`);
      variant.stock = parsed.stock;
    }
    if (parsed.active !== undefined && parsed.active !== variant.isActive) {
      changes.push(`${sku} status: ${formatBool(variant.isActive)} → ${formatBool(parsed.active)}`);
      variant.isActive = parsed.active;
    }
    if (parsed.images) {
      const next = imageList(variant.images, parsed.images, knownImages);
      if (next) {
        changes.push(`${sku} images: ${next.summary}`);
        variant.images = next.images;
      }
    }
    if (parsed.price !== undefined || parsed.compareAtPrice !== undefined) {
      compareWarning(`${sku} `, variant.price, variant.compareAtPrice);
    }
  }

  // Two variants a shopper can't tell apart (colorCode and case ignored).
  const signatures = new Map<string, string>();
  for (const variant of doc.variants) {
    const signature = attributeSignature(variant.attributes);
    const clash = signatures.get(signature);
    if (clash !== undefined) {
      const row = skuRows.get(variant.sku) ?? skuRows.get(clash) ?? firstRow.rowNumber;
      rowError(
        row,
        `${variant.sku} has the same attributes as ${clash} (${formatAttributes(variant.attributes)})`,
      );
    } else {
      signatures.set(signature, variant.sku);
    }
  }

  if (!isNew) {
    const untouched = doc.variants.filter((v) => !skuRows.has(v.sku)).map((v) => v.sku);
    if (untouched.length > 0) {
      warnings.push(
        `${untouched.length} existing variant${untouched.length > 1 ? 's are' : ' is'} not in the file and will be left unchanged: ${untouched.join(', ')}`,
      );
    }
  } else {
    if (doc.variants.length === 0) {
      rowError(
        firstRow.rowNumber,
        'a new variant product needs at least one variant row with a sku',
      );
    }
    if (doc.variantAttributeNames.length === 0) {
      const first = doc.variants[0];
      doc.variantAttributeNames = first
        ? [...first.attributes.keys()].filter((key) => key !== 'colorCode')
        : [];
    }
    if (doc.variants.length > 0 && doc.variants.every((v) => v.images.length === 0)) {
      warnings.push('No images — add image URLs so the product has photos');
    }
    changes.unshift('new variant product');
  }

  return plan(doc, type);
}

/** Last line of defence: anything the schema itself would reject on save. */
function withSchemaCheck(outcome: PlanOutcome, firstRow: number): PlanOutcome {
  if (!outcome.doc) return outcome;
  const validation = outcome.doc.validateSync();
  if (!validation) return outcome;
  const messages = Object.values(validation.errors).map((e) => `Row ${firstRow}: ${e.message}`);
  return {
    plan: { ...outcome.plan, action: 'error', errors: [...outcome.plan.errors, ...messages] },
    doc: null,
  };
}

function planWithContext(group: RowGroup, ctx: ImportContext, existing?: ProductDocument | null) {
  const target = existing !== undefined ? existing : locateExisting(group, ctx).existing;
  return withSchemaCheck(planGroup(group, target, ctx), group.rows[0].rowNumber);
}

async function prepare(csv: string): Promise<{ groups: RowGroup[]; ctx: ImportContext }> {
  const rows = readRows(csv);
  const groups = groupRows(rows);
  const ctx = await loadContext(rows, groups);
  return { groups, ctx };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function previewProductImport(csv: string): Promise<ImportPreview> {
  const { groups, ctx } = await prepare(csv);
  const products = groups.map((group) => planWithContext(group, ctx).plan);
  const count = (action: ImportAction) => products.filter((p) => p.action === action).length;
  return {
    summary: {
      products: products.length,
      create: count('create'),
      update: count('update'),
      unchanged: count('unchanged'),
      error: count('error'),
    },
    products,
  };
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

function cloudinaryMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'unknown error';
}

/** Has Cloudinary fetch every image URL that's new to this product. */
async function uploadPendingImages(doc: ProductDocument): Promise<void> {
  const lists = [doc.images, ...doc.variants.map((v) => v.images)];
  const pending = [
    ...new Set(
      lists
        .flat()
        .filter((img) => img.publicId === PENDING_PUBLIC_ID)
        .map((img) => img.url),
    ),
  ];
  if (pending.length === 0) return;

  const uploaded = new Map<string, { url: string; publicId: string }>();
  await mapWithConcurrency(pending, REMOTE_UPLOAD_CONCURRENCY, async (url) => {
    try {
      const result = await uploadRemoteImageToCloudinary(url);
      uploaded.set(url, { url: result.url, publicId: result.publicId });
    } catch (err) {
      throw ApiError.badRequest(
        `Couldn't fetch image ${truncate(url, 80)}: ${cloudinaryMessage(err)}`,
      );
    }
  });

  for (const list of lists) {
    for (const img of list) {
      const result = img.publicId === PENDING_PUBLIC_ID ? uploaded.get(img.url) : undefined;
      if (result) {
        img.url = result.url;
        img.publicId = result.publicId;
      }
    }
  }
}

function friendlyCommitError(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: unknown }).code === 11000
  ) {
    const keyValue = (err as { keyValue?: Record<string, unknown> }).keyValue ?? {};
    const [field, value] = Object.entries(keyValue)[0] ?? [];
    if (field === 'slug') return `The handle "${String(value)}" is already used by another product`;
    if (field === 'sku' || field === 'variants.sku') {
      return `SKU ${String(value)} is already used by another product`;
    }
    return 'A SKU or handle in this product is already used by another product';
  }
  if (err instanceof ApiError) return err.message;
  if (err && typeof err === 'object' && 'errors' in err && err instanceof Error) {
    const details = Object.values((err as { errors: Record<string, { message: string }> }).errors);
    return details.map((d) => d.message).join('; ') || err.message;
  }
  return 'Unexpected error while saving this product — try again';
}

async function commitGroup(group: RowGroup, ctx: ImportContext): Promise<ImportCommitResult> {
  const key = group.key;

  // Re-read right before applying so an admin edit made since the preview
  // (or since this request loaded its context) isn't overwritten with stale
  // values — only the cells the file actually fills are applied on top.
  let fresh: ProductDocument | null = null;
  const located = locateExisting(group, ctx).existing;
  if (located) {
    fresh = await Product.findById(located._id);
    if (!fresh) {
      return { key, status: 'failed', error: 'This product was deleted after the preview' };
    }
  }

  const { plan, doc } = planWithContext(group, ctx, fresh);
  if (!doc || plan.action === 'error') {
    return { key, status: 'skipped', error: plan.errors.join('; ') || 'Validation failed' };
  }
  if (plan.action === 'unchanged') {
    return { key, status: 'unchanged', slug: doc.slug };
  }

  if (plan.action === 'create') {
    if (group.handle) {
      if (await Product.exists({ slug: group.handle })) {
        return { key, status: 'failed', error: `The handle "${group.handle}" is already in use` };
      }
      doc.slug = group.handle;
    } else {
      doc.slug = await generateUniqueProductSlug(slugify(doc.name) ? doc.name : 'product');
    }
  }

  await uploadPendingImages(doc);
  await doc.save();
  return { key, status: plan.action === 'create' ? 'created' : 'updated', slug: doc.slug };
}

export async function commitProductImport(
  csv: string,
  keys: string[],
): Promise<ImportCommitResult[]> {
  const startedAt = Date.now();
  const { groups, ctx } = await prepare(csv);
  const byKey = new Map(groups.map((group) => [group.key, group]));

  const results: ImportCommitResult[] = [];
  for (const key of keys) {
    const group = byKey.get(key);
    if (!group) {
      results.push({ key, status: 'skipped', error: 'This product is not in the uploaded file' });
      continue;
    }
    if (Date.now() - startedAt > COMMIT_TIME_BUDGET_MS) {
      results.push({
        key,
        status: 'skipped',
        error: 'Not attempted — the request ran out of time. Import this product again.',
      });
      continue;
    }
    try {
      results.push(await commitGroup(group, ctx));
    } catch (err) {
      const error = friendlyCommitError(err);
      logger.warn('Product import: product failed', {
        key,
        error,
        cause: err instanceof Error ? err.message : undefined,
      });
      results.push({ key, status: 'failed', error });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Export & template
// ---------------------------------------------------------------------------

type ExportRow = Record<Column, CsvCell>;

function toCsv(rows: ExportRow[]): string {
  return serializeCsv(
    [[...IMPORT_COLUMNS], ...rows.map((row) => IMPORT_COLUMNS.map((column) => row[column]))],
    { bom: true, escapeFormulas: true },
  );
}

const urls = (images: ProductImage[] | undefined) => (images ?? []).map((img) => img.url).join('|');
const bool = (value: boolean | undefined) => (value === false ? 'FALSE' : 'TRUE');

export async function exportProductsCsv(): Promise<string> {
  const [products, categories, occasions] = await Promise.all([
    // Oldest first, inactive included — the export doubles as a backup.
    Product.find({}).sort({ _id: 1 }).lean(),
    Category.find({}, 'slug').lean(),
    Occasion.find({}, 'slug').lean(),
  ]);
  const categorySlugs = new Map(categories.map((c) => [c._id.toString(), c.slug]));
  const occasionSlugs = new Map(occasions.map((o) => [o._id.toString(), o.slug]));

  const rows: ExportRow[] = [];
  for (const product of products) {
    const productColumns = {
      name: product.name,
      type: product.type,
      category: categorySlugs.get(product.category?.toString() ?? '') ?? '',
      occasions: (product.occasions ?? [])
        .map((id) => occasionSlugs.get(id.toString()))
        .filter(Boolean)
        .join('|'),
      fabric: product.fabric ?? '',
      color: product.color ?? '',
      loomType: product.loomType ?? 'unknown',
      description: product.description ?? '',
      seoTitle: product.seoTitle ?? '',
      seoDescription: product.seoDescription ?? '',
      productActive: bool(product.isActive),
      variantAttributeNames:
        product.type === 'variant' ? (product.variantAttributeNames ?? []).join('|') : '',
    };
    const blankVariant = {
      sku: '',
      attributes: '',
      price: '',
      compareAtPrice: '',
      stock: '',
      variantActive: '',
      images: '',
    };

    if (product.type === 'simple') {
      rows.push({
        handle: product.slug,
        ...productColumns,
        ...blankVariant,
        sku: product.sku ?? '',
        price: product.price ?? '',
        compareAtPrice: product.compareAtPrice ?? '',
        stock: product.stock ?? 0,
        images: urls(product.images),
      });
      continue;
    }

    const variants = product.variants ?? [];
    if (variants.length === 0) {
      rows.push({ handle: product.slug, ...productColumns, ...blankVariant });
      continue;
    }
    const blankProductColumns = Object.fromEntries(
      Object.keys(productColumns).map((column) => [column, '']),
    ) as typeof productColumns;
    variants.forEach((variant, index) => {
      // Product columns only on the first row: repeating them would make an
      // edit to row 1 alone conflict with the stale copy on row 2.
      rows.push({
        handle: product.slug,
        ...(index === 0 ? productColumns : blankProductColumns),
        sku: variant.sku,
        attributes: formatAttributes(variant.attributes),
        price: variant.price,
        compareAtPrice: variant.compareAtPrice ?? '',
        stock: variant.stock,
        variantActive: bool(variant.isActive),
        images: urls(variant.images),
      });
    });
  }
  return toCsv(rows);
}

/** `sareegrace-products-YYYY-MM-DD.csv`, dated in the store's timezone (IST). */
export function exportFilename(now: Date = new Date()): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return `sareegrace-products-${date}.csv`;
}

const SAMPLE_IMAGE = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';

/**
 * One simple product and one variant product with two variants. Uses a real
 * category/occasion slug from this store so the template previews cleanly,
 * and productActive FALSE so importing it by accident publishes nothing.
 */
export async function buildImportTemplateCsv(): Promise<string> {
  const [category, occasion] = await Promise.all([
    Category.findOne({ isActive: true }).sort({ name: 1 }).lean(),
    Occasion.findOne({ isActive: true }).sort({ name: 1 }).lean(),
  ]);
  const categorySlug = category?.slug ?? 'your-category-slug';
  const occasionSlug = occasion?.slug ?? '';

  const blank = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, ''])) as ExportRow;
  const rows: ExportRow[] = [
    {
      ...blank,
      handle: 'example-chettinad-cotton-saree',
      name: 'Example Chettinad Cotton Saree',
      type: 'simple',
      category: categorySlug,
      occasions: occasionSlug,
      fabric: 'Cotton',
      color: 'Mustard',
      loomType: 'handloom',
      description:
        'Lightweight Chettinad cotton saree with a contrast border.\nIncludes blouse piece.',
      seoTitle: 'Chettinad Cotton Saree in Mustard',
      productActive: 'FALSE',
      sku: 'SG-EXAMPLE-COTTON-01',
      price: '₹1,499',
      compareAtPrice: '1899',
      stock: 5,
      images: SAMPLE_IMAGE,
    },
    {
      ...blank,
      handle: 'example-soft-silk-saree',
      name: 'Example Soft Silk Saree',
      type: 'variant',
      category: categorySlug,
      occasions: occasionSlug,
      fabric: 'Soft Silk',
      loomType: 'powerloom',
      description: 'Soft silk saree with zari border, available in two colours.',
      productActive: 'FALSE',
      variantAttributeNames: 'color',
      sku: 'SG-EXAMPLE-SILK-MAROON',
      attributes: 'color=Maroon|colorCode=#800000',
      price: '2499',
      compareAtPrice: '2999',
      stock: 4,
      variantActive: 'TRUE',
      images: SAMPLE_IMAGE,
    },
    {
      ...blank,
      handle: 'example-soft-silk-saree',
      sku: 'SG-EXAMPLE-SILK-GREEN',
      attributes: 'color=Bottle Green|colorCode=#006A4E',
      price: '2299',
      stock: 0,
      variantActive: 'TRUE',
      images: SAMPLE_IMAGE,
    },
  ];
  return toCsv(rows);
}
