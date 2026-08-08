import { request, buildApp, createAdmin, createUser, authHeader } from '../helpers';
import { Product } from '../../src/models/Product';
import { Category } from '../../src/models/Category';

describe('Categories', () => {
  const app = buildApp();

  it('allows an admin to create a category with an auto-generated slug', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post('/api/v1/categories')
      .set(authHeader(admin.token))
      .send({ name: 'Silk Sarees' });

    expect(res.status).toBe(201);
    expect(res.body.data.category.slug).toBe('silk-sarees');
  });

  it('rejects category creation from a non-admin', async () => {
    const customer = await createUser();
    const res = await request(app)
      .post('/api/v1/categories')
      .set(authHeader(customer.token))
      .send({ name: 'Cotton Sarees' });
    expect(res.status).toBe(403);
  });

  it('disambiguates duplicate names with a numeric slug suffix instead of rejecting', async () => {
    const admin = await createAdmin();
    const first = await request(app)
      .post('/api/v1/categories')
      .set(authHeader(admin.token))
      .send({ name: 'Banarasi' });
    const second = await request(app)
      .post('/api/v1/categories')
      .set(authHeader(admin.token))
      .send({ name: 'Banarasi' });

    expect(first.body.data.category.slug).toBe('banarasi');
    expect(second.body.data.category.slug).toBe('banarasi-2');
  });

  it('lists categories publicly without auth', async () => {
    const admin = await createAdmin();
    await request(app)
      .post('/api/v1/categories')
      .set(authHeader(admin.token))
      .send({ name: 'Kanjivaram' });

    const res = await request(app).get('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(res.body.data.categories.length).toBeGreaterThan(0);
  });

  it('blocks deleting a category that still has products', async () => {
    const admin = await createAdmin();
    const category = await Category.create({ name: 'Occasion Wear', slug: 'occasion-wear' });
    await Product.create({
      type: 'simple',
      name: 'Red Saree',
      slug: 'red-saree',
      description: 'A red saree',
      category: category._id,
      price: 1000,
      stock: 5,
    });

    const res = await request(app)
      .delete(`/api/v1/categories/${category._id.toString()}`)
      .set(authHeader(admin.token));

    expect(res.status).toBe(409);
    const stillExists = await Category.findById(category._id);
    expect(stillExists).not.toBeNull();
  });

  it('allows an admin to update a category name and re-slug it', async () => {
    const admin = await createAdmin();
    const createRes = await request(app)
      .post('/api/v1/categories')
      .set(authHeader(admin.token))
      .send({ name: 'Chiffon Sarees' });
    const categoryId = createRes.body.data.category._id;

    const updateRes = await request(app)
      .put(`/api/v1/categories/${categoryId}`)
      .set(authHeader(admin.token))
      .send({ name: 'Georgette Sarees' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.category.name).toBe('Georgette Sarees');
    expect(updateRes.body.data.category.slug).toBe('georgette-sarees');
  });

  it('rejects a category update from a non-admin', async () => {
    const admin = await createAdmin();
    const customer = await createUser();
    const createRes = await request(app)
      .post('/api/v1/categories')
      .set(authHeader(admin.token))
      .send({ name: 'Linen Sarees' });

    const res = await request(app)
      .put(`/api/v1/categories/${createRes.body.data.category._id}`)
      .set(authHeader(customer.token))
      .send({ name: 'Hacked Name' });

    expect(res.status).toBe(403);
  });

  it('allows deleting a category with no dependent products', async () => {
    const admin = await createAdmin();
    const category = await Category.create({ name: 'Empty Category', slug: 'empty-category' });

    const res = await request(app)
      .delete(`/api/v1/categories/${category._id.toString()}`)
      .set(authHeader(admin.token));

    expect(res.status).toBe(200);
    expect(await Category.findById(category._id)).toBeNull();
  });
});
