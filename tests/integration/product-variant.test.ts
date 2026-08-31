import { request, buildApp, createAdmin, createUser, authHeader } from '../helpers';
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

  it('rejects cross-type duplicate SKU (simple product SKU matching variant SKU)', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    const productId = await createShell(admin, categoryId);

    await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'GLOBAL-SKU-1')
      .field('attributes', JSON.stringify({ color: 'red' }))
      .field('price', '1000')
      .field('stock', '5');

    // Attempt to create simple product with the same SKU
    const simpleRes = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'simple')
      .field('name', 'Conflict Saree')
      .field('description', 'desc')
      .field('category', categoryId)
      .field('sku', 'global-sku-1')
      .field('price', '2000')
      .field('stock', '3');

    expect(simpleRes.status).toBe(409);
  });
});

describe('Variant products (storefront, cart, and checkout flow)', () => {
  const app = buildApp();
  const shippingAddress = {
    fullName: 'Test Customer',
    phone: '9876543210',
    line1: '123 Main St',
    city: 'Chennai',
    state: 'Tamil Nadu',
    postalCode: '600001',
    country: 'India',
  };

  it('adds variant to cart, validates stock, and captures authoritative snapshot', async () => {
    const admin = await createAdmin();
    const user = await createUser();
    const categoryId = await makeCategory();

    const createShellRes = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'variant')
      .field('name', 'Kanjivaram Silk Saree')
      .field('description', 'Authentic silk saree')
      .field('category', categoryId)
      .field('variantAttributeNames', 'color');

    const productId = createShellRes.body.data.product._id;

    const addVarRes = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('sku', 'KS-RED')
      .field('attributes', JSON.stringify({ color: 'Crimson Red' }))
      .field('price', '4500')
      .field('stock', '5')
      .attach('images', fakeImage, { filename: 'red.jpg', contentType: 'image/jpeg' });

    const variantId = addVarRes.body.data.product.variants[0]._id;

    // 1. Missing variantId for variant product -> 400
    const missingVarRes = await request(app)
      .post('/api/v1/cart')
      .set(authHeader(user.token))
      .send({ productId, qty: 1 });
    expect(missingVarRes.status).toBe(400);

    // 2. Non-existent variantId -> 404
    const invalidVarRes = await request(app)
      .post('/api/v1/cart')
      .set(authHeader(user.token))
      .send({ productId, variantId: '600000000000000000000001', qty: 1 });
    expect(invalidVarRes.status).toBe(404);

    // 3. Exceeds stock -> 409
    const overStockRes = await request(app)
      .post('/api/v1/cart')
      .set(authHeader(user.token))
      .send({ productId, variantId, qty: 10 });
    expect(overStockRes.status).toBe(409);

    // 4. Valid add to cart
    const addCartRes = await request(app)
      .post('/api/v1/cart')
      .set(authHeader(user.token))
      .send({ productId, variantId, qty: 2 });
    expect(addCartRes.status).toBe(201);
    const cartItem = addCartRes.body.data.cart.items[0];
    expect(cartItem.product).toBe(productId);
    expect(cartItem.variantId).toBe(variantId);
    expect(cartItem.qty).toBe(2);
    expect(cartItem.priceSnapshot).toBe(4500);
    expect(cartItem.nameSnapshot).toBe('Kanjivaram Silk Saree');
    expect(cartItem.imageSnapshot).toBeDefined();

    // 5. Checkout order decrements variant stock
    const orderRes = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(user.token))
      .send({ shippingAddress });
    expect(orderRes.status).toBe(201);
    const order = orderRes.body.data.order;
    expect(order.items[0].variantId).toBe(variantId);
    expect(order.items[0].priceSnapshot).toBe(4500);
    expect(order.itemsTotal).toBe(9000);

    // Verify database stock was decremented for the variant
    const productAfterOrder = await Product.findById(productId);
    const variantAfterOrder = productAfterOrder?.variants.find(
      (v) => v._id.toString() === variantId,
    );
    expect(variantAfterOrder?.stock).toBe(3);

    // 6. Cancel order restores variant stock
    const cancelRes = await request(app)
      .post(`/api/v1/orders/${order._id}/cancel`)
      .set(authHeader(user.token));
    expect(cancelRes.status).toBe(200);

    const productAfterCancel = await Product.findById(productId);
    const variantAfterCancel = productAfterCancel?.variants.find(
      (v) => v._id.toString() === variantId,
    );
    expect(variantAfterCancel?.stock).toBe(5);
  });

  it('creates a variant product on a single page with multiple variants and per-variant images', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();

    const variantsPayload = [
      {
        sku: 'SP-MAROON',
        attributes: { color: 'Maroon', colorCode: '#800000' },
        price: 3999,
        stock: 10,
      },
      {
        sku: 'SP-GOLD',
        attributes: { color: 'Gold', colorCode: '#D4AF37' },
        price: 4299,
        stock: 5,
      },
    ];

    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'variant')
      .field('name', 'Single Page Luxury Saree')
      .field('description', 'Single page creation test description')
      .field('category', categoryId)
      .field('variantAttributeNames', 'color,colorCode')
      .field('variants', JSON.stringify(variantsPayload))
      .attach('variant_image_0', fakeImage, { filename: 'maroon.jpg', contentType: 'image/jpeg' })
      .attach('variant_image_1', fakeImage, { filename: 'gold.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    const product = res.body.data.product;
    expect(product.type).toBe('variant');
    expect(product.variants).toHaveLength(2);
    expect(product.variants[0].sku).toBe('SP-MAROON');
    expect(product.variants[0].images).toHaveLength(1);
    expect(product.variants[1].sku).toBe('SP-GOLD');
    expect(product.variants[1].images).toHaveLength(1);
    expect(product.startingPrice).toBe(3999);
    expect(product.maxPrice).toBe(4299);
  });

  it('rejects creating a variant product if any variant is missing an image', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();

    const variantsPayload = [
      {
        sku: 'NOIMG-1',
        attributes: { color: 'Red' },
        price: 2000,
        stock: 10,
      },
      {
        sku: 'NOIMG-2',
        attributes: { color: 'Blue' },
        price: 2200,
        stock: 5,
      },
    ];

    // Only attach image for variant 0, leaving variant 1 with no image
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'variant')
      .field('name', 'No Image Saree')
      .field('description', 'desc')
      .field('category', categoryId)
      .field('variantAttributeNames', 'color')
      .field('variants', JSON.stringify(variantsPayload))
      .attach('variant_image_0', fakeImage, { filename: 'red.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/must have at least one image/i);
  });

  it('updates a variant product on a single page, adding new images and variants atomically', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();

    // Create initial variant product with 1 variant
    const createRes = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'variant')
      .field('name', 'Editable Saree')
      .field('description', 'desc')
      .field('category', categoryId)
      .field('variantAttributeNames', 'color')
      .field(
        'variants',
        JSON.stringify([{ sku: 'INIT-1', attributes: { color: 'Teal' }, price: 2500, stock: 4 }]),
      )
      .attach('variant_image_0', fakeImage, { filename: 'teal.jpg', contentType: 'image/jpeg' });

    expect(createRes.status).toBe(201);
    const initialProduct = createRes.body.data.product;
    const variant1Id = initialProduct.variants[0]._id;

    // Single-page update: update variant 1 (new price), and add new variant 2
    const updateVariants = [
      {
        _id: variant1Id,
        sku: 'INIT-1-UPDATED',
        attributes: { color: 'Teal' },
        price: 2700,
        stock: 8,
      },
      {
        sku: 'INIT-2-NEW',
        attributes: { color: 'Pink' },
        price: 2900,
        stock: 3,
      },
    ];

    const updateRes = await request(app)
      .put(`/api/v1/admin/products/${initialProduct._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('name', 'Editable Saree Renamed')
      .field('variants', JSON.stringify(updateVariants))
      .attach('variant_image_1', fakeImage, { filename: 'pink.jpg', contentType: 'image/jpeg' });

    expect(updateRes.status).toBe(200);
    const updated = updateRes.body.data.product;
    expect(updated.name).toBe('Editable Saree Renamed');
    expect(updated.variants).toHaveLength(2);
    expect(updated.variants[0].sku).toBe('INIT-1-UPDATED');
    expect(updated.variants[0].price).toBe(2700);
    expect(updated.variants[0].stock).toBe(8);
    expect(updated.variants[0].images).toHaveLength(1); // Retained existing image
    expect(updated.variants[1].sku).toBe('INIT-2-NEW');
    expect(updated.variants[1].images).toHaveLength(1); // Uploaded new image
  });

  it('rejects updating if any variant ends up with 0 images', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();

    const createRes = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'variant')
      .field('name', 'Remove Image Saree')
      .field('description', 'desc')
      .field('category', categoryId)
      .field('variantAttributeNames', 'color')
      .field(
        'variants',
        JSON.stringify([{ sku: 'REM-1', attributes: { color: 'Purple' }, price: 3000, stock: 2 }]),
      )
      .attach('variant_image_0', fakeImage, { filename: 'purple.jpg', contentType: 'image/jpeg' });

    const initialProduct = createRes.body.data.product;
    const variantId = initialProduct.variants[0]._id;
    const publicId = initialProduct.variants[0].images[0].publicId;

    // Try to update by removing the only image without adding a new one
    const updateRes = await request(app)
      .put(`/api/v1/admin/products/${initialProduct._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field(
        'variants',
        JSON.stringify([
          {
            _id: variantId,
            sku: 'REM-1',
            attributes: { color: 'Purple' },
            price: 3000,
            stock: 2,
            removeImagePublicIds: [publicId],
          },
        ]),
      );

    expect(updateRes.status).toBe(400);
    expect(updateRes.body.error.message).toMatch(/must have at least one image/i);
  });

  describe('Comprehensive Variant Stock Management & Isolation', () => {
    it('maintains independent stock per variant and rejects overselling even if sibling variant has stock', async () => {
      const admin = await createAdmin();
      const user = await createUser();
      const categoryId = await makeCategory();

      // 1. Create a variant product with Variant A (stock 10) and Variant B (stock 5)
      const variantsPayload = [
        {
          sku: 'VAR-STOCK-A',
          attributes: { color: 'Royal Blue' },
          price: 3500,
          stock: 10,
        },
        {
          sku: 'VAR-STOCK-B',
          attributes: { color: 'Emerald Green' },
          price: 3800,
          stock: 5,
        },
      ];

      const createRes = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${admin.token}`)
        .field('type', 'variant')
        .field('name', 'Kanchipuram Silk Contrast Saree')
        .field('description', 'Authentic weave')
        .field('category', categoryId)
        .field('variantAttributeNames', 'color')
        .field('variants', JSON.stringify(variantsPayload))
        .attach('variant_image_0', fakeImage, { filename: 'blue.jpg', contentType: 'image/jpeg' })
        .attach('variant_image_1', fakeImage, { filename: 'green.jpg', contentType: 'image/jpeg' });

      expect(createRes.status).toBe(201);
      const product = createRes.body.data.product;
      const productId = product._id;
      const variantAId = product.variants[0]._id;
      const variantBId = product.variants[1]._id;

      const shippingAddress = {
        fullName: 'Test Customer',
        phone: '9876543210',
        line1: '123 Main St',
        city: 'Chennai',
        state: 'Tamil Nadu',
        postalCode: '600001',
        country: 'India',
      };

      // 2. Purchase Variant A quantity 2 -> Variant A = 8, Variant B = 5
      await request(app)
        .post('/api/v1/cart')
        .set(authHeader(user.token))
        .send({ productId, variantId: variantAId, qty: 2 });

      const order1Res = await request(app)
        .post('/api/v1/orders')
        .set(authHeader(user.token))
        .send({ shippingAddress });

      expect(order1Res.status).toBe(201);
      expect(order1Res.body.data.order.items[0].skuSnapshot).toBe('VAR-STOCK-A');
      expect(order1Res.body.data.order.items[0].variantId).toBe(variantAId);

      let p = await Product.findById(productId);
      expect(p?.variants.find((v) => v._id.toString() === variantAId)?.stock).toBe(8);
      expect(p?.variants.find((v) => v._id.toString() === variantBId)?.stock).toBe(5);

      // 3. Purchase Variant B quantity 3 -> Variant A = 8, Variant B = 2
      await request(app)
        .post('/api/v1/cart')
        .set(authHeader(user.token))
        .send({ productId, variantId: variantBId, qty: 3 });

      const order2Res = await request(app)
        .post('/api/v1/orders')
        .set(authHeader(user.token))
        .send({ shippingAddress });

      expect(order2Res.status).toBe(201);
      expect(order2Res.body.data.order.items[0].skuSnapshot).toBe('VAR-STOCK-B');
      expect(order2Res.body.data.order.items[0].variantId).toBe(variantBId);

      p = await Product.findById(productId);
      expect(p?.variants.find((v) => v._id.toString() === variantAId)?.stock).toBe(8);
      expect(p?.variants.find((v) => v._id.toString() === variantBId)?.stock).toBe(2);

      // 4. Attempt to purchase Variant A quantity 9 -> must fail because only 8 are available
      // First try adding 9 to cart -> should be rejected by cart stock check
      const overCartRes = await request(app)
        .post('/api/v1/cart')
        .set(authHeader(user.token))
        .send({ productId, variantId: variantAId, qty: 9 });
      expect(overCartRes.status).toBe(409);

      // Add valid qty 8 to cart, then artificially change stock in db to test order-time rejection
      await request(app)
        .post('/api/v1/cart')
        .set(authHeader(user.token))
        .send({ productId, variantId: variantAId, qty: 8 });

      // Directly set stock to 7 in db to simulate concurrent purchase
      await Product.updateOne(
        { _id: productId, 'variants._id': variantAId },
        { $set: { 'variants.$.stock': 7 } },
      );

      const overOrderRes = await request(app)
        .post('/api/v1/orders')
        .set(authHeader(user.token))
        .send({ shippingAddress });

      expect(overOrderRes.status).toBe(409);
      expect(overOrderRes.body.error.message).toMatch(/insufficient stock/i);

      // Verify stock remained unchanged at 7 for A and 2 for B
      p = await Product.findById(productId);
      expect(p?.variants.find((v) => v._id.toString() === variantAId)?.stock).toBe(7);
      expect(p?.variants.find((v) => v._id.toString() === variantBId)?.stock).toBe(2);

      // 5. Edit Variant A stock from admin to 20 -> verify DB and admin response show 20
      const editVariants = [
        {
          _id: variantAId,
          sku: 'VAR-STOCK-A',
          attributes: { color: 'Royal Blue' },
          price: 3500,
          stock: 20,
        },
        {
          _id: variantBId,
          sku: 'VAR-STOCK-B',
          attributes: { color: 'Emerald Green' },
          price: 3800,
          stock: 2,
        },
      ];

      const editRes = await request(app)
        .put(`/api/v1/admin/products/${productId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .field('variants', JSON.stringify(editVariants));

      expect(editRes.status).toBe(200);
      const updatedP = editRes.body.data.product;
      expect(
        updatedP.variants.find((v: { _id: string }) => v._id.toString() === variantAId)?.stock,
      ).toBe(20);
      expect(
        updatedP.variants.find((v: { _id: string }) => v._id.toString() === variantBId)?.stock,
      ).toBe(2);

      // Verify direct database query also confirms stock 20 and 2
      p = await Product.findById(productId);
      expect(p?.variants.find((v) => v._id.toString() === variantAId)?.stock).toBe(20);
      expect(p?.variants.find((v) => v._id.toString() === variantBId)?.stock).toBe(2);
    });

    it('preserves simple product stock deduction and restoration without regressions', async () => {
      const admin = await createAdmin();
      const user = await createUser();
      const categoryId = await makeCategory();

      const createRes = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${admin.token}`)
        .field('type', 'simple')
        .field('name', 'Simple Cotton Saree')
        .field('description', 'Cotton saree')
        .field('category', categoryId)
        .field('price', '1500')
        .field('stock', '10')
        .field('sku', 'SMP-COTTON-01')
        .attach('images', fakeImage, { filename: 'cotton.jpg', contentType: 'image/jpeg' });

      expect(createRes.status).toBe(201);
      const productId = createRes.body.data.product._id;

      // Add to cart and checkout
      await request(app)
        .post('/api/v1/cart')
        .set(authHeader(user.token))
        .send({ productId, qty: 4 });

      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set(authHeader(user.token))
        .send({
          shippingAddress: {
            fullName: 'Test Customer',
            phone: '9876543210',
            line1: '123 Main St',
            city: 'Chennai',
            state: 'Tamil Nadu',
            postalCode: '600001',
            country: 'India',
          },
        });

      expect(orderRes.status).toBe(201);
      expect(orderRes.body.data.order.items[0].skuSnapshot).toBe('SMP-COTTON-01');

      let p = await Product.findById(productId);
      expect(p?.stock).toBe(6);

      // Cancel order and verify stock is restored
      await request(app)
        .post(`/api/v1/orders/${orderRes.body.data.order._id}/cancel`)
        .set(authHeader(user.token));

      p = await Product.findById(productId);
      expect(p?.stock).toBe(10);
    });
  });
});
