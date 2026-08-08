import { request, buildApp, createUser, authHeader } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';

describe('Wishlist', () => {
  const app = buildApp();

  async function makeProduct(): Promise<string> {
    const category = await Category.create({
      name: 'Wishlist Cat',
      slug: `wishlist-cat-${Date.now()}-${Math.random()}`,
    });
    const product = await Product.create({
      type: 'simple',
      name: 'Wishlist Product',
      slug: `wishlist-product-${Date.now()}-${Math.random()}`,
      description: 'desc',
      category: category._id,
      price: 500,
      stock: 5,
    });
    return product._id.toString();
  }

  it('adds a product to the wishlist', async () => {
    const user = await createUser();
    const productId = await makeProduct();

    const res = await request(app)
      .post(`/api/v1/wishlist/${productId}`)
      .set(authHeader(user.token));

    expect(res.status).toBe(201);
    expect(res.body.data.wishlist.productIds).toContain(productId);
  });

  it('treats a duplicate add as a no-op, not an error', async () => {
    const user = await createUser();
    const productId = await makeProduct();

    await request(app).post(`/api/v1/wishlist/${productId}`).set(authHeader(user.token));
    const secondAdd = await request(app)
      .post(`/api/v1/wishlist/${productId}`)
      .set(authHeader(user.token));

    expect(secondAdd.status).toBe(201);
    const productIdCount = secondAdd.body.data.wishlist.productIds.filter(
      (id: string) => id === productId,
    ).length;
    expect(productIdCount).toBe(1);
  });

  it('removes a product from the wishlist', async () => {
    const user = await createUser();
    const productId = await makeProduct();

    await request(app).post(`/api/v1/wishlist/${productId}`).set(authHeader(user.token));
    const removeRes = await request(app)
      .delete(`/api/v1/wishlist/${productId}`)
      .set(authHeader(user.token));

    expect(removeRes.status).toBe(200);
    expect(removeRes.body.data.wishlist.productIds).not.toContain(productId);
  });
});
