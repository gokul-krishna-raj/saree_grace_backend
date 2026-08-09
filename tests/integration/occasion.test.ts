import { request, buildApp, createAdmin, createUser, authHeader } from '../helpers';
import { Occasion } from '../../src/models/Occasion';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';

const fakeImage = Buffer.from('fake-image-bytes');

async function makeCategory(): Promise<string> {
  const category = await Category.create({ name: 'Sarees', slug: 'sarees' });
  return category._id.toString();
}

describe('Occasions', () => {
  const app = buildApp();

  it('allows an admin to create an occasion with an auto-generated slug', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post('/api/v1/occasions')
      .set(authHeader(admin.token))
      .field('name', 'Wedding')
      .attach('image', fakeImage, { filename: 'wedding.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.data.occasion.slug).toBe('wedding');
    expect(res.body.data.occasion.image.url).toEqual(expect.any(String));
  });

  it('rejects occasion creation from a non-admin', async () => {
    const customer = await createUser();
    const res = await request(app)
      .post('/api/v1/occasions')
      .set(authHeader(customer.token))
      .send({ name: 'Festive' });
    expect(res.status).toBe(403);
  });

  it('disambiguates duplicate names with a numeric slug suffix', async () => {
    const admin = await createAdmin();
    const first = await request(app)
      .post('/api/v1/occasions')
      .set(authHeader(admin.token))
      .send({ name: 'Bridal' });
    const second = await request(app)
      .post('/api/v1/occasions')
      .set(authHeader(admin.token))
      .send({ name: 'Bridal' });

    expect(first.body.data.occasion.slug).toBe('bridal');
    expect(second.body.data.occasion.slug).toBe('bridal-2');
  });

  it('lists only active occasions, alphabetized', async () => {
    await Occasion.create({ name: 'Zesty Casual', slug: 'zesty-casual', isActive: true });
    await Occasion.create({ name: 'Anniversary', slug: 'anniversary', isActive: true });
    await Occasion.create({ name: 'Hidden', slug: 'hidden', isActive: false });

    const res = await request(app).get('/api/v1/occasions');
    expect(res.status).toBe(200);
    const names = res.body.data.occasions.map((o: { name: string }) => o.name);
    expect(names).toEqual(['Anniversary', 'Zesty Casual']);
  });

  it('blocks deletion of an occasion still referenced by a product', async () => {
    const admin = await createAdmin();
    const occasion = await Occasion.create({ name: 'Festive', slug: 'festive' });
    const categoryId = await makeCategory();
    await Product.create({
      type: 'simple',
      name: 'Festive Saree',
      slug: 'festive-saree',
      description: 'desc',
      category: categoryId,
      occasions: [occasion._id],
      price: 1000,
      stock: 5,
    });

    const res = await request(app)
      .delete(`/api/v1/occasions/${occasion._id.toString()}`)
      .set(authHeader(admin.token));

    expect(res.status).toBe(409);
    expect(await Occasion.findById(occasion._id)).not.toBeNull();
  });

  it('allows deletion once no product references the occasion', async () => {
    const admin = await createAdmin();
    const occasion = await Occasion.create({ name: 'Casual', slug: 'casual' });

    const res = await request(app)
      .delete(`/api/v1/occasions/${occasion._id.toString()}`)
      .set(authHeader(admin.token));

    expect(res.status).toBe(200);
    expect(await Occasion.findById(occasion._id)).toBeNull();
  });

  it('filters the product listing by occasion', async () => {
    const categoryId = await makeCategory();
    const wedding = await Occasion.create({ name: 'Wedding Shop', slug: 'wedding-shop' });
    const casual = await Occasion.create({ name: 'Casual Shop', slug: 'casual-shop' });

    await Product.create({
      type: 'simple',
      name: 'Wedding Silk Saree',
      slug: 'wedding-silk-saree',
      description: 'desc',
      category: categoryId,
      occasions: [wedding._id],
      price: 5000,
      stock: 5,
    });
    await Product.create({
      type: 'simple',
      name: 'Casual Cotton Saree',
      slug: 'casual-cotton-saree',
      description: 'desc',
      category: categoryId,
      occasions: [casual._id],
      price: 500,
      stock: 5,
    });

    const res = await request(app)
      .get('/api/v1/products')
      .query({ occasion: wedding._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].name).toBe('Wedding Silk Saree');
    expect(res.body.data.products[0].occasions[0].slug).toBe('wedding-shop');
  });
});
