import { request, buildApp, createAdmin } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';
import { deleteCloudinaryImages } from '../../src/utils/cloudinaryUpload';

const fakeImage = Buffer.from('fake-image-bytes');

async function makeCategory(): Promise<string> {
  const category = await Category.create({ name: 'Sarees', slug: 'sarees' });
  return category._id.toString();
}

describe('Simple products (admin)', () => {
  const app = buildApp();

  it('creates a simple product with uploaded images', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();

    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'simple')
      .field('name', 'Blue Cotton Saree')
      .field('description', 'A lovely blue cotton saree')
      .field('category', categoryId)
      .field('price', '1499')
      .field('stock', '10')
      .attach('images', fakeImage, { filename: 'saree.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.data.product.slug).toBe('blue-cotton-saree');
    expect(res.body.data.product.images).toHaveLength(1);
    expect(res.body.data.product.images[0].url).toEqual(expect.any(String));
  });

  it('rejects an unsupported file type', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();

    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'simple')
      .field('name', 'Bad Upload Saree')
      .field('description', 'desc')
      .field('category', categoryId)
      .field('price', '999')
      .field('stock', '5')
      .attach('images', Buffer.from('not an image'), {
        filename: 'virus.exe',
        contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(400);
  });

  it('updates a product and removes a specific image, cleaning up Cloudinary', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();

    const createRes = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'simple')
      .field('name', 'Green Saree')
      .field('description', 'desc')
      .field('category', categoryId)
      .field('price', '2000')
      .field('stock', '3')
      .attach('images', fakeImage, { filename: 'a.jpg', contentType: 'image/jpeg' });

    const productId = createRes.body.data.product._id;
    const publicId = createRes.body.data.product.images[0].publicId;

    const updateRes = await request(app)
      .put(`/api/v1/admin/products/${productId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('removeImagePublicIds', publicId)
      .field('price', '2200');

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.product.images).toHaveLength(0);
    expect(updateRes.body.data.product.price).toBe(2200);
    expect(deleteCloudinaryImages).toHaveBeenCalledWith([publicId]);
  });

  it('deletes a product and cleans up all of its Cloudinary images', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();

    const createRes = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'simple')
      .field('name', 'Delete Me Saree')
      .field('description', 'desc')
      .field('category', categoryId)
      .field('price', '1000')
      .field('stock', '1')
      .attach('images', fakeImage, { filename: 'a.jpg', contentType: 'image/jpeg' });

    const productId = createRes.body.data.product._id;
    const publicId = createRes.body.data.product.images[0].publicId;

    const deleteRes = await request(app)
      .delete(`/api/v1/admin/products/${productId}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(deleteRes.status).toBe(200);
    expect(await Product.findById(productId)).toBeNull();
    expect(deleteCloudinaryImages).toHaveBeenCalledWith([publicId]);
  });

  it('rejects setting stock to a negative number', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    const product = await Product.create({
      type: 'simple',
      name: 'Stock Test Saree',
      slug: 'stock-test-saree',
      description: 'desc',
      category: categoryId,
      price: 500,
      stock: 5,
    });

    const res = await request(app)
      .put(`/api/v1/admin/products/${product._id.toString()}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('stock', '-5');

    expect(res.status).toBe(400);
  });

  it('rejects a duplicate SKU', async () => {
    const admin = await createAdmin();
    const categoryId = await makeCategory();
    await Product.create({
      type: 'simple',
      name: 'SKU One',
      slug: 'sku-one',
      description: 'desc',
      category: categoryId,
      price: 500,
      stock: 5,
      sku: 'SG-001',
    });

    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'simple')
      .field('name', 'SKU Two')
      .field('description', 'desc')
      .field('category', categoryId)
      .field('price', '600')
      .field('stock', '2')
      .field('sku', 'sg-001');

    expect(res.status).toBe(409);
  });
});
