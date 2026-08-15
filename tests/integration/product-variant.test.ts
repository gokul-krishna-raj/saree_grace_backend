import { request, buildApp, createAdmin } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';
import { deleteCloudinaryImages } from '../../src/utils/cloudinaryUpload';

const fakeImage = Buffer.from('fake-image-bytes');

async function makeCategory(): Promise<string> {
  const category = await Category.create({ name: 'Variant Sarees', slug: 'variant-sarees' });
  return category._id.toString();
}

describe('Variant products (admin)', () => {
  const app = buildApp();

  it('creates a variant shell product', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();

    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'variant')
      .field('name', 'Designer Saree')
      .field('description', 'desc')
      .field('category', categoryId)
      .field('variantAttributeNames', 'color,size');

    expect(res.status).toBe(201);
    expect(res.body.data.product.type).toBe('variant');
    expect(res.body.data.product.variantAttributeNames).toEqual(['color', 'size']);
    expect(res.body.data.product.variants).toEqual([]);
  });

  async function createShell(admin: { token: string }, categoryId: string): Promise<string> {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'variant')
      .field('name', 'Shell Saree')
      .field('description', 'desc')
      .field('category', categoryId)
      .field('variantAttributeNames', 'color');
    return res.body.data.product._id;
  }

  it('adds a variant with its own images and computes starting-from price', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    const productId = await createShell(admin, categoryId);

    await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'VAR-RED')
      .field('attributes', JSON.stringify({ color: 'red' }))
      .field('price', '3000')
      .field('stock', '5')
      .attach('images', fakeImage, { filename: 'red.jpg', contentType: 'image/jpeg' });

    const addSecond = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'VAR-BLUE')
      .field('attributes', JSON.stringify({ color: 'blue' }))
      .field('price', '2500')
      .field('stock', '2');

    expect(addSecond.status).toBe(201);
    const product = await Product.findById(productId);
    expect(product?.variants).toHaveLength(2);
    expect(product?.minPrice()).toBe(2500);
    // The API response itself (not just the server-side method) must carry
    // the computed starting price so the frontend never recomputes it.
    expect(addSecond.body.data.product.startingPrice).toBe(2500);

    const publicRes = await request(app).get(`/api/v1/products/${product?.slug}`);
    expect(publicRes.body.data.product.startingPrice).toBe(2500);
  });

  it('accepts a valid colorCode attribute alongside color', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    const productId = await createShell(admin, categoryId);

    const res = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'CC-1')
      .field('attributes', JSON.stringify({ color: 'Maroon', colorCode: '#800000' }))
      .field('price', '1000')
      .field('stock', '1');

    expect(res.status).toBe(201);
    const variant = res.body.data.product.variants[0];
    expect(variant.attributes.color).toBe('Maroon');
    expect(variant.attributes.colorCode).toBe('#800000');
  });

  it('rejects a malformed colorCode attribute', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    const productId = await createShell(admin, categoryId);

    const res = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'CC-2')
      .field('attributes', JSON.stringify({ color: 'Maroon', colorCode: 'not-a-hex' }))
      .field('price', '1000')
      .field('stock', '1');

    expect(res.status).toBe(400);
  });

  it('rejects a malformed colorCode attribute on variant update', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    const productId = await createShell(admin, categoryId);

    const addRes = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'CC-3')
      .field('attributes', JSON.stringify({ color: 'Maroon', colorCode: '#800000' }))
      .field('price', '1000')
      .field('stock', '1');
    const variantId = addRes.body.data.product.variants[0]._id;

    const res = await request(app)
      .patch(`/api/v1/admin/products/${productId}/variants/${variantId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('attributes', JSON.stringify({ color: 'Maroon', colorCode: 'purple' }));

    expect(res.status).toBe(400);
  });

  it('rejects a duplicate SKU across variants', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    const productId = await createShell(admin, categoryId);

    await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'DUP-SKU')
      .field('attributes', JSON.stringify({ color: 'red' }))
      .field('price', '1000')
      .field('stock', '1');

    const res = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'dup-sku')
      .field('attributes', JSON.stringify({ color: 'green' }))
      .field('price', '1200')
      .field('stock', '1');

    expect(res.status).toBe(409);
  });

  it('rejects a duplicate attribute combination across variants', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    const productId = await createShell(admin, categoryId);

    await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'ATTR-1')
      .field('attributes', JSON.stringify({ color: 'red' }))
      .field('price', '1000')
      .field('stock', '1');

    const res = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'ATTR-2')
      .field('attributes', JSON.stringify({ color: 'red' }))
      .field('price', '1200')
      .field('stock', '1');

    expect(res.status).toBe(409);
  });

  it('rejects updating a variant to attributes another variant already has', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    const productId = await createShell(admin, categoryId);

    await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'ATTR-RED')
      .field('attributes', JSON.stringify({ color: 'red' }))
      .field('price', '1000')
      .field('stock', '1');
    const addBlue = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'ATTR-BLUE')
      .field('attributes', JSON.stringify({ color: 'blue' }))
      .field('price', '1000')
      .field('stock', '1');
    const blueVariantId = addBlue.body.data.product.variants.find(
      (v: { sku: string }) => v.sku === 'ATTR-BLUE',
    )._id;

    const res = await request(app)
      .patch(`/api/v1/admin/products/${productId}/variants/${blueVariantId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('attributes', JSON.stringify({ color: 'red' }));

    expect(res.status).toBe(409);
  });

  it('exposes maxPrice, totalStock and variantCount aggregate fields', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    const productId = await createShell(admin, categoryId);

    await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'AGG-RED')
      .field('attributes', JSON.stringify({ color: 'red' }))
      .field('price', '4999')
      .field('stock', '5');
    const res = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'AGG-BLUE')
      .field('attributes', JSON.stringify({ color: 'blue' }))
      .field('price', '5299')
      .field('stock', '12');

    expect(res.body.data.product.minPrice).toBeUndefined();
    expect(res.body.data.product.startingPrice).toBe(4999);
    expect(res.body.data.product.maxPrice).toBe(5299);
    expect(res.body.data.product.totalStock).toBe(17);
    expect(res.body.data.product.variantCount).toBe(2);

    const publicRes = await request(app).get(`/api/v1/products/${res.body.data.product.slug}`);
    expect(publicRes.body.data.product.maxPrice).toBe(5299);
    expect(publicRes.body.data.product.totalStock).toBe(17);
    expect(publicRes.body.data.product.variantCount).toBe(2);
  });

  it('updates a single variant independently of the others', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    const productId = await createShell(admin, categoryId);

    const addRes = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'UPD-1')
      .field('attributes', JSON.stringify({ color: 'red' }))
      .field('price', '1000')
      .field('stock', '5');
    const variantId = addRes.body.data.product.variants[0]._id;

    const patchRes = await request(app)
      .patch(`/api/v1/admin/products/${productId}/variants/${variantId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('stock', '9');

    expect(patchRes.status).toBe(200);
    const updatedVariant = patchRes.body.data.product.variants.find(
      (v: { _id: string }) => v._id === variantId,
    );
    expect(updatedVariant.stock).toBe(9);
  });

  it('deletes a variant and cleans up its Cloudinary images', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    const productId = await createShell(admin, categoryId);

    const addRes = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'DEL-1')
      .field('attributes', JSON.stringify({ color: 'red' }))
      .field('price', '1000')
      .field('stock', '5')
      .attach('images', fakeImage, { filename: 'del.jpg', contentType: 'image/jpeg' });
    const variantId = addRes.body.data.product.variants[0]._id;
    const publicId = addRes.body.data.product.variants[0].images[0].publicId;

    const deleteRes = await request(app)
      .delete(`/api/v1/admin/products/${productId}/variants/${variantId}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data.product.variants).toHaveLength(0);
    expect(deleteCloudinaryImages).toHaveBeenCalledWith([publicId]);
  });
});
