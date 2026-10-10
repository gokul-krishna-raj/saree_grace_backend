import { request, buildApp, createAdmin, createUser, authHeader } from '../helpers';
import { Category } from '../../src/models/Category';
import { Occasion } from '../../src/models/Occasion';
import { Product } from '../../src/models/Product';
import { IMPORT_COLUMNS } from '../../src/modules/product/product-io.service';
import { parseCsv, serializeCsv, unescapeFormula } from '../../src/utils/csv';
import { uploadRemoteImageToCloudinary } from '../../src/utils/cloudinaryUpload';

type Column = (typeof IMPORT_COLUMNS)[number];
type Row = Partial<Record<Column, string | number>>;

const uploadRemote = uploadRemoteImageToCloudinary as jest.Mock;
const BASE = '/api/v1/admin/products';

function toCsv(rows: Row[]): string {
  return serializeCsv([[...IMPORT_COLUMNS], ...rows.map((r) => IMPORT_COLUMNS.map((c) => r[c]))]);
}

/** Parses an exported CSV into objects keyed by column, undoing formula escapes. */
function fromCsv(text: string): Array<Record<Column, string>> {
  const [header, ...rows] = parseCsv(text);
  return rows.map(
    (row) =>
      Object.fromEntries(
        (header ?? []).map((column, i) => [column, unescapeFormula(row[i] ?? '')]),
      ) as Record<Column, string>,
  );
}

async function seedRefs() {
  const silk = await Category.create({ name: 'Silk Sarees', slug: 'silk-sarees' });
  const cotton = await Category.create({ name: 'Cotton Sarees', slug: 'cotton-sarees' });
  const wedding = await Occasion.create({ name: 'Wedding', slug: 'wedding' });
  const festive = await Occasion.create({ name: 'Festive', slug: 'festive' });
  return { silk, cotton, wedding, festive };
}

const simpleRow = (overrides: Row = {}): Row => ({
  handle: 'mustard-cotton-saree',
  name: 'Mustard Cotton Saree',
  type: 'simple',
  category: 'cotton-sarees',
  occasions: 'Festive',
  fabric: 'Cotton',
  loomType: 'handloom',
  description: 'Soft cotton saree',
  productActive: 'TRUE',
  sku: 'sg-cot-mustard',
  price: '₹1,499',
  compareAtPrice: '1899',
  stock: '5',
  images: 'https://images.example.com/mustard-1.jpg|https://images.example.com/mustard-2.jpg',
  ...overrides,
});

const variantRows = (): Row[] => [
  {
    handle: 'soft-silk-saree',
    name: 'Soft Silk Saree',
    type: 'variant',
    category: 'Silk Sarees',
    occasions: 'wedding|festive',
    loomType: 'powerloom',
    description: 'Soft silk with zari border',
    productActive: 'yes',
    variantAttributeNames: 'color',
    sku: 'SG-SOFT-PINK',
    attributes: 'color=Pink|colorCode=#FFC0CB',
    price: 'Rs 2499',
    stock: '4',
    variantActive: 'TRUE',
    images: 'https://images.example.com/pink.jpg',
  },
  {
    handle: 'soft-silk-saree',
    sku: 'SG-SOFT-MAROON',
    attributes: 'color=Maroon|colorCode=#800000',
    price: '2299',
    stock: '0',
    variantActive: 'no',
    images: 'https://images.example.com/maroon.jpg',
  },
];

describe('Bulk product CSV import/export (admin)', () => {
  const app = buildApp();

  async function preview(token: string, csv: string) {
    return request(app).post(`${BASE}/import/preview`).set(authHeader(token)).send({ csv });
  }

  async function commit(token: string, csv: string, keys: string[]) {
    return request(app).post(`${BASE}/import/commit`).set(authHeader(token)).send({ csv, keys });
  }

  async function importAll(token: string, csv: string) {
    const res = await preview(token, csv);
    expect(res.status).toBe(200);
    const keys = res.body.data.products
      .filter((p: { action: string }) => p.action === 'create' || p.action === 'update')
      .map((p: { key: string }) => p.key);
    return commit(token, csv, keys);
  }

  async function exportCsv(token: string) {
    const res = await request(app).get(`${BASE}/export`).set(authHeader(token));
    expect(res.status).toBe(200);
    return res;
  }

  function planFor(
    res: { body: { data: { products: Array<Record<string, unknown>> } } },
    key: string,
  ) {
    const plan = res.body.data.products.find((p) => p.key === key);
    expect(plan).toBeDefined();
    return plan as {
      action: string;
      changes: string[];
      warnings: string[];
      errors: string[];
      rows: number[];
    };
  }

  describe('access control', () => {
    it('rejects customers with 403 and anonymous callers with 401', async () => {
      const customer = await createUser();
      const csv = toCsv([simpleRow()]);
      const calls = [
        () => request(app).get(`${BASE}/export`),
        () => request(app).get(`${BASE}/import/template`),
        () => request(app).post(`${BASE}/import/preview`).send({ csv }),
        () =>
          request(app)
            .post(`${BASE}/import/commit`)
            .send({ csv, keys: ['handle:x'] }),
      ];
      for (const call of calls) {
        expect((await call()).status).toBe(401);
        expect((await call().set(authHeader(customer.token))).status).toBe(403);
      }
    });
  });

  describe('preview', () => {
    it('plans creates without writing anything or touching Cloudinary', async () => {
      const admin = await createAdmin();
      await seedRefs();
      const csv = toCsv([simpleRow(), ...variantRows()]);

      const res = await preview(admin.token, csv);

      expect(res.status).toBe(200);
      expect(res.body.data.summary).toEqual({
        products: 2,
        create: 2,
        update: 0,
        unchanged: 0,
        error: 0,
      });
      const variant = planFor(res, 'handle:soft-silk-saree');
      expect(variant.rows).toEqual([3, 4]);
      expect(variant.changes).toEqual(
        expect.arrayContaining(['new variant SG-SOFT-PINK', 'new variant SG-SOFT-MAROON']),
      );
      expect(await Product.countDocuments()).toBe(0);
      expect(uploadRemote).not.toHaveBeenCalled();
    });

    it('returns 400 naming missing required columns', async () => {
      const admin = await createAdmin();
      const csv = 'Handle,Name,Type,Price\nx,X,simple,100\n';
      const res = await preview(admin.token, csv);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Missing required columns: sku, stock/);
    });

    it('matches headers case- and space-insensitively', async () => {
      const admin = await createAdmin();
      await seedRefs();
      const csv = serializeCsv([
        ['HANDLE', 'Name', 'type', 'Category', 'Description', 'S K U', 'Price', ' Stock '],
        ['plain-saree', 'Plain Saree', 'simple', 'cotton-sarees', 'desc', 'SG-PLAIN', '999', '3'],
      ]);
      const res = await preview(admin.token, csv);
      expect(res.status).toBe(200);
      expect(res.body.data.summary.create).toBe(1);
    });

    it('rejects an empty body, an oversized commit and a file over the row cap', async () => {
      const admin = await createAdmin();
      expect((await preview(admin.token, '')).status).toBe(400);
      const keys = Array.from({ length: 26 }, (_, i) => `handle:p-${i}`);
      expect((await commit(admin.token, toCsv([simpleRow()]), keys)).status).toBe(400);

      const rows = Array.from({ length: 2001 }, (_, i) =>
        simpleRow({ handle: `p-${i}`, sku: `SKU-${i}`, images: '' }),
      );
      const res = await preview(admin.token, toCsv(rows));
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/limit is 2000/);
    });
  });

  describe('commit', () => {
    it('creates simple and variant products', async () => {
      const admin = await createAdmin();
      const { cotton, silk, wedding, festive } = await seedRefs();
      const csv = toCsv([simpleRow(), ...variantRows()]);

      const res = await importAll(admin.token, csv);

      expect(res.status).toBe(200);
      expect(res.body.data.results).toEqual([
        { key: 'handle:mustard-cotton-saree', status: 'created', slug: 'mustard-cotton-saree' },
        { key: 'handle:soft-silk-saree', status: 'created', slug: 'soft-silk-saree' },
      ]);

      const simple = await Product.findOne({ slug: 'mustard-cotton-saree' });
      expect(simple?.type).toBe('simple');
      expect(simple?.sku).toBe('SG-COT-MUSTARD');
      expect(simple?.price).toBe(1499);
      expect(simple?.compareAtPrice).toBe(1899);
      expect(simple?.sortPrice).toBe(1499);
      expect(simple?.category.toString()).toBe(cotton._id.toString());
      expect(simple?.occasions.map(String)).toEqual([festive._id.toString()]);
      expect(simple?.loomType).toBe('handloom');
      expect(simple?.images).toHaveLength(2);
      expect(simple?.images[0]?.isPrimary).toBe(true);
      expect(simple?.images[1]?.isPrimary).toBe(false);
      expect(simple?.images[0]?.url).toMatch(/^https:\/\/res\.cloudinary\.com\//);

      const variant = await Product.findOne({ slug: 'soft-silk-saree' });
      expect(variant?.type).toBe('variant');
      expect(variant?.category.toString()).toBe(silk._id.toString());
      expect(variant?.occasions.map(String).sort()).toEqual(
        [wedding._id.toString(), festive._id.toString()].sort(),
      );
      expect(variant?.variantAttributeNames).toEqual(['color']);
      expect(variant?.variants).toHaveLength(2);
      const [pink, maroon] = variant?.variants ?? [];
      expect(pink?.price).toBe(2499);
      expect(pink?.attributes.get('colorCode')).toBe('#FFC0CB');
      expect(maroon?.isActive).toBe(false);
      expect(maroon?.attributes.get('color')).toBe('Maroon');
      // Lowest *active* variant price — the inactive ₹2299 maroon is ignored.
      expect(variant?.sortPrice).toBe(2499);

      expect(uploadRemote).toHaveBeenCalledTimes(4);
    });

    it('applies only the requested keys and skips unknown ones', async () => {
      const admin = await createAdmin();
      await seedRefs();
      const csv = toCsv([simpleRow(), ...variantRows()]);

      const res = await commit(admin.token, csv, ['handle:soft-silk-saree', 'handle:nope']);

      expect(res.body.data.results).toEqual([
        { key: 'handle:soft-silk-saree', status: 'created', slug: 'soft-silk-saree' },
        { key: 'handle:nope', status: 'skipped', error: expect.any(String) },
      ]);
      expect(await Product.countDocuments()).toBe(1);
    });

    it('keeps going when one product fails, and saves nothing for the failed one', async () => {
      const admin = await createAdmin();
      await seedRefs();
      uploadRemote.mockImplementationOnce(async () => {
        throw { message: 'Resource not found - https://images.example.com/mustard-1.jpg' };
      });

      const res = await importAll(admin.token, toCsv([simpleRow(), ...variantRows()]));

      expect(res.status).toBe(200);
      const [failed, created] = res.body.data.results;
      expect(failed.status).toBe('failed');
      expect(failed.error).toMatch(/Couldn't fetch image .*mustard-1\.jpg: Resource not found/);
      expect(created).toEqual({
        key: 'handle:soft-silk-saree',
        status: 'created',
        slug: 'soft-silk-saree',
      });
      expect(await Product.exists({ slug: 'mustard-cotton-saree' })).toBeNull();
    });

    it('re-importing an untouched export changes nothing', async () => {
      const admin = await createAdmin();
      await seedRefs();
      await importAll(
        admin.token,
        toCsv([
          simpleRow({ name: '=HYPERLINK("http://evil")', description: 'Line one\nLine "two", ok' }),
          ...variantRows(),
          simpleRow({
            handle: 'hidden-saree',
            sku: 'SG-HIDDEN',
            productActive: 'FALSE',
            images: '',
            occasions: '',
          }),
        ]),
      );
      uploadRemote.mockClear();

      const exported = await exportCsv(admin.token);
      expect(exported.headers['content-type']).toMatch(/^text\/csv/);
      expect(exported.headers['content-disposition']).toMatch(
        /attachment; filename="sareegrace-products-\d{4}-\d{2}-\d{2}\.csv"/,
      );
      expect(exported.text.charCodeAt(0)).toBe(0xfeff);
      // Formula-looking cells are neutralised for spreadsheets.
      expect(exported.text).toContain(`"'=HYPERLINK(""http://evil"")"`);

      const rows = fromCsv(exported.text);
      // Oldest first, inactive products included.
      expect(rows.map((r) => r.handle)).toEqual([
        'mustard-cotton-saree',
        'soft-silk-saree',
        'soft-silk-saree',
        'hidden-saree',
      ]);
      expect(rows[3]?.productActive).toBe('FALSE');
      // Product columns only on a variant product's first row.
      expect(rows[2]?.name).toBe('');

      const res = await preview(admin.token, exported.text);
      expect(res.status).toBe(200);
      expect(res.body.data.summary).toEqual({
        products: 3,
        create: 0,
        update: 0,
        unchanged: 3,
        error: 0,
      });
      expect(uploadRemote).not.toHaveBeenCalled();
    });

    it('updates price, stock and status from an edited export without re-uploading images', async () => {
      const admin = await createAdmin();
      await seedRefs();
      await importAll(admin.token, toCsv([simpleRow(), ...variantRows()]));
      uploadRemote.mockClear();
      const before = await Product.findOne({ slug: 'mustard-cotton-saree' });

      const rows = fromCsv((await exportCsv(admin.token)).text);
      rows[0]!.price = '₹1,299';
      rows[0]!.productActive = 'FALSE';
      rows[1]!.stock = '9';
      rows[2]!.variantActive = 'TRUE';
      const csv = serializeCsv([
        [...IMPORT_COLUMNS],
        ...rows.map((r) => IMPORT_COLUMNS.map((c) => r[c])),
      ]);

      const res = await preview(admin.token, csv);
      expect(planFor(res, 'handle:mustard-cotton-saree').changes).toEqual([
        'status: active → hidden',
        'price: ₹1499 → ₹1299',
      ]);
      expect(planFor(res, 'handle:soft-silk-saree').changes).toEqual([
        'SG-SOFT-PINK stock: 4 → 9',
        'SG-SOFT-MAROON status: hidden → active',
      ]);

      const committed = await importAll(admin.token, csv);
      expect(committed.body.data.results.map((r: { status: string }) => r.status)).toEqual([
        'updated',
        'updated',
      ]);

      const simple = await Product.findOne({ slug: 'mustard-cotton-saree' });
      expect(simple?.price).toBe(1299);
      expect(simple?.sortPrice).toBe(1299);
      expect(simple?.isActive).toBe(false);
      expect(simple?.images.map((i) => i.publicId)).toEqual(before?.images.map((i) => i.publicId));
      const variant = await Product.findOne({ slug: 'soft-silk-saree' });
      expect(variant?.variants[0]?.stock).toBe(9);
      expect(variant?.variants[1]?.isActive).toBe(true);
      // The maroon variant is active now, so it sets the starting price.
      expect(variant?.sortPrice).toBe(2299);
      expect(uploadRemote).not.toHaveBeenCalled();
    });

    it('keeps values for blank cells, adds a variant for a new SKU and never deletes', async () => {
      const admin = await createAdmin();
      await seedRefs();
      await importAll(admin.token, toCsv(variantRows()));
      uploadRemote.mockClear();
      const created = await Product.findOne({ slug: 'soft-silk-saree' });
      const pinkImageUrl = created?.variants[0]?.images[0]?.url ?? '';

      const csv = toCsv([
        {
          handle: 'soft-silk-saree',
          name: 'Soft Silk Saree (Renamed)',
          sku: 'SG-SOFT-PINK',
          price: '2399',
        },
        {
          handle: 'soft-silk-saree',
          sku: 'SG-SOFT-BLUE',
          attributes: 'color=Blue',
          price: '2599',
          stock: '3',
          images: `https://images.example.com/blue.jpg|${pinkImageUrl}`,
        },
      ]);

      const res = await preview(admin.token, csv);
      const plan = planFor(res, 'handle:soft-silk-saree');
      expect(plan.action).toBe('update');
      expect(plan.changes).toEqual([
        'name: "Soft Silk Saree" → "Soft Silk Saree (Renamed)"',
        'SG-SOFT-PINK price: ₹2499 → ₹2399',
        'new variant SG-SOFT-BLUE',
      ]);
      expect(plan.warnings).toEqual([
        '1 existing variant is not in the file and will be left unchanged: SG-SOFT-MAROON',
      ]);

      await importAll(admin.token, csv);
      const product = await Product.findOne({ slug: 'soft-silk-saree' });
      expect(product?.name).toBe('Soft Silk Saree (Renamed)');
      // Renaming keeps the slug (URL and future imports stay stable).
      expect(product?.slug).toBe('soft-silk-saree');
      expect(product?.description).toBe('Soft silk with zari border');
      expect(product?.occasions).toHaveLength(2);
      expect(product?.variants.map((v) => v.sku)).toEqual([
        'SG-SOFT-PINK',
        'SG-SOFT-MAROON',
        'SG-SOFT-BLUE',
      ]);
      const pink = product?.variants[0];
      expect(pink?.price).toBe(2399);
      expect(pink?.stock).toBe(4);
      expect(pink?.attributes.get('colorCode')).toBe('#FFC0CB');
      const blue = product?.variants[2];
      expect(blue?.images).toHaveLength(2);
      expect(blue?.images[0]?.isPrimary).toBe(true);
      // The pink image already on the product is reused, not re-uploaded.
      expect(blue?.images[1]?.publicId).toBe(pink?.images[0]?.publicId);
      expect(uploadRemote).toHaveBeenCalledTimes(1);
      expect(uploadRemote).toHaveBeenCalledWith('https://images.example.com/blue.jpg');
    });

    it('matches a simple product by SKU when the handle is blank', async () => {
      const admin = await createAdmin();
      await seedRefs();
      await importAll(admin.token, toCsv([simpleRow()]));

      const csv = toCsv([{ sku: 'SG-COT-MUSTARD', stock: '1' }]);
      const res = await preview(admin.token, csv);
      expect(planFor(res, 'sku:SG-COT-MUSTARD').changes).toEqual(['stock: 5 → 1']);
      await importAll(admin.token, csv);
      expect((await Product.findOne({ sku: 'SG-COT-MUSTARD' }))?.stock).toBe(1);
      expect(await Product.countDocuments()).toBe(1);
    });

    it('does not overwrite an admin edit made after the preview', async () => {
      const admin = await createAdmin();
      await seedRefs();
      await importAll(admin.token, toCsv([simpleRow()]));

      const csv = toCsv([{ handle: 'mustard-cotton-saree', price: '1399' }]);
      const res = await preview(admin.token, csv);
      expect(planFor(res, 'handle:mustard-cotton-saree').action).toBe('update');

      // Someone edits stock and the name in the admin UI meanwhile.
      await Product.updateOne(
        { slug: 'mustard-cotton-saree' },
        { $set: { stock: 42, name: 'Edited Elsewhere' } },
      );

      const committed = await commit(admin.token, csv, ['handle:mustard-cotton-saree']);
      expect(committed.body.data.results[0].status).toBe('updated');
      const product = await Product.findOne({ slug: 'mustard-cotton-saree' });
      expect(product?.price).toBe(1399);
      expect(product?.stock).toBe(42);
      expect(product?.name).toBe('Edited Elsewhere');
    });
  });

  describe('validation', () => {
    it('reports row-level errors and saves nothing invalid', async () => {
      const admin = await createAdmin();
      await seedRefs();
      await importAll(admin.token, toCsv([simpleRow({ handle: 'taken', sku: 'SG-TAKEN' })]));

      const csv = toCsv([
        // row 2: unknown category + occasion, bad price, negative stock
        simpleRow({
          handle: 'bad-a',
          sku: 'A1',
          category: 'linen',
          occasions: 'party',
          price: 'abc',
          stock: '-1',
        }),
        // row 3: bad loomType, bad boolean, bad image URL, price 0
        simpleRow({
          handle: 'bad-b',
          sku: 'B1',
          loomType: 'hand',
          productActive: 'maybe',
          images: 'ftp://x/y.jpg',
          price: '0',
        }),
        // row 4: duplicate SKU within the file
        simpleRow({ handle: 'bad-c', sku: 'a1' }),
        // row 5: SKU owned by another product
        simpleRow({ handle: 'bad-d', sku: 'SG-TAKEN' }),
        // rows 6–7: simple product spanning two rows
        simpleRow({ handle: 'bad-e', sku: 'E1' }),
        { handle: 'bad-e', sku: 'E2', price: '100', stock: '1' },
        // rows 8–9: duplicate attribute combination (case + colorCode ignored)
        { ...variantRows()[0], handle: 'bad-f', sku: 'F1', attributes: 'color=Red|colorCode=#f00' },
        { handle: 'bad-f', sku: 'F2', attributes: 'color=red', price: '100', stock: '1' },
        // row 10: new product missing required fields
        { handle: 'bad-g', type: 'simple', sku: 'G1', price: '100' },
        // row 11: name too long, bad colorCode on a variant
        {
          ...variantRows()[0],
          handle: 'bad-h',
          sku: 'H1',
          name: 'x'.repeat(201),
          attributes: 'color=Red|colorCode=red',
        },
      ]);

      const res = await preview(admin.token, csv);
      expect(res.status).toBe(200);
      expect(res.body.data.summary.error).toBe(8);
      const errorsOf = (key: string) => planFor(res, key).errors.join('\n');

      expect(errorsOf('handle:bad-a')).toMatch(/Row 2: category "linen" does not exist/);
      expect(errorsOf('handle:bad-a')).toMatch(/Row 2: occasion "party" does not exist/);
      expect(errorsOf('handle:bad-a')).toMatch(/Row 2: price "abc" is not a valid amount/);
      expect(errorsOf('handle:bad-a')).toMatch(/Row 2: stock "-1" must be a whole number/);
      expect(errorsOf('handle:bad-b')).toMatch(/Row 3: loomType must be/);
      expect(errorsOf('handle:bad-b')).toMatch(/Row 3: productActive must be TRUE or FALSE/);
      expect(errorsOf('handle:bad-b')).toMatch(
        /Row 3: image "ftp:\/\/x\/y.jpg" must be an http\(s\) URL/,
      );
      expect(errorsOf('handle:bad-b')).toMatch(/Row 3: price must be greater than 0/);
      expect(errorsOf('handle:bad-c')).toMatch(/Row 4: SKU A1 is also used on row 2/);
      expect(errorsOf('handle:bad-d')).toMatch(
        /Row 5: SKU SG-TAKEN already belongs to another product \("taken"\)/,
      );
      expect(errorsOf('handle:bad-e')).toMatch(/Row 7: a simple product must be a single row/);
      expect(errorsOf('handle:bad-f')).toMatch(/Row 9: F2 has the same attributes as F1/);
      expect(errorsOf('handle:bad-g')).toMatch(/Row 10: name is required/);
      expect(errorsOf('handle:bad-g')).toMatch(/Row 10: description is required/);
      expect(errorsOf('handle:bad-g')).toMatch(/Row 10: category is required/);
      expect(errorsOf('handle:bad-g')).toMatch(/Row 10: stock is required/);
      expect(errorsOf('handle:bad-h')).toMatch(/Row 11: name must be 2–200 characters/);
      expect(errorsOf('handle:bad-h')).toMatch(/Row 11: colorCode "red" must be a hex colour/);

      const keys = res.body.data.products.map((p: { key: string }) => p.key);
      const committed = await commit(admin.token, csv, keys);
      expect(committed.status).toBe(200);
      expect(
        committed.body.data.results.every((r: { status: string }) => r.status === 'skipped'),
      ).toBe(true);
      expect(await Product.countDocuments()).toBe(1);
    });

    it('requires attributes, price and stock for a new variant', async () => {
      const admin = await createAdmin();
      await seedRefs();
      await importAll(admin.token, toCsv(variantRows()));

      const res = await preview(
        admin.token,
        toCsv([{ handle: 'soft-silk-saree', sku: 'SG-SOFT-GOLD', price: '100' }]),
      );
      expect(planFor(res, 'handle:soft-silk-saree').errors).toEqual([
        'Row 2: new variant SG-SOFT-GOLD needs attributes, stock',
      ]);
    });

    it('rejects changing the type of an existing product', async () => {
      const admin = await createAdmin();
      await seedRefs();
      await importAll(admin.token, toCsv([simpleRow()]));

      const csv = toCsv([
        {
          handle: 'mustard-cotton-saree',
          type: 'variant',
          sku: 'SG-COT-MUSTARD',
          attributes: 'color=Mustard',
          price: '1499',
          stock: '5',
        },
      ]);
      const res = await preview(admin.token, csv);
      const plan = planFor(res, 'handle:mustard-cotton-saree');
      expect(plan.action).toBe('error');
      expect(plan.errors[0]).toMatch(/Row 2: type can't be changed from simple to variant/);

      const committed = await commit(admin.token, csv, ['handle:mustard-cotton-saree']);
      expect(committed.body.data.results[0].status).toBe('skipped');
      expect((await Product.findOne({ slug: 'mustard-cotton-saree' }))?.type).toBe('simple');
    });

    it('warns about a compareAtPrice below price and a new product without images', async () => {
      const admin = await createAdmin();
      await seedRefs();
      const res = await preview(
        admin.token,
        toCsv([simpleRow({ compareAtPrice: '999', images: '' })]),
      );
      const plan = planFor(res, 'handle:mustard-cotton-saree');
      expect(plan.action).toBe('create');
      expect(plan.warnings).toEqual(
        expect.arrayContaining([
          'compareAtPrice ₹999 is lower than price ₹1499',
          expect.stringMatching(/^No images/),
        ]),
      );
    });

    it('flags a product-level value that differs on a later row', async () => {
      const admin = await createAdmin();
      await seedRefs();
      const [first, second] = variantRows();
      const res = await preview(admin.token, toCsv([first!, { ...second, name: 'Other Name' }]));
      expect(planFor(res, 'handle:soft-silk-saree').errors[0]).toMatch(
        /Row 3: name "Other Name" differs from row 2/,
      );
    });
  });

  describe('template', () => {
    it('downloads a template that previews cleanly', async () => {
      const admin = await createAdmin();
      await seedRefs();

      const res = await request(app).get(`${BASE}/import/template`).set(authHeader(admin.token));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      const rows = fromCsv(res.text);
      expect(rows).toHaveLength(3);
      expect(rows.filter((r) => r.type === 'variant')).toHaveLength(1);

      const previewRes = await preview(admin.token, res.text);
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.summary).toEqual({
        products: 2,
        create: 2,
        update: 0,
        unchanged: 0,
        error: 0,
      });
      for (const product of previewRes.body.data.products) {
        expect(product.warnings).toEqual([]);
      }
    });
  });
});
