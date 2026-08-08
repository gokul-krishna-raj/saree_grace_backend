import { request, buildApp, createUser, authHeader } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';

async function makeProduct(stock = 5): Promise<string> {
  const category = await Category.create({
    name: 'Cart Cat',
    slug: `cart-cat-${Date.now()}-${Math.random()}`,
  });
  const product = await Product.create({
    type: 'simple',
    name: 'Cart Product',
    slug: `cart-product-${Date.now()}-${Math.random()}`,
    description: 'desc',
    category: category._id,
    price: 500,
    stock,
  });
  return product._id.toString();
}

describe('Cart', () => {
  const app = buildApp();

  it('adds an item to the cart', async () => {
    const user = await createUser();
    const productId = await makeProduct(10);

    const res = await request(app)
      .post('/api/v1/cart')
      .set(authHeader(user.token))
      .send({ productId, qty: 2 });

    expect(res.status).toBe(201);
    expect(res.body.data.cart.items).toHaveLength(1);
    expect(res.body.data.cart.items[0].qty).toBe(2);
  });

  it('rejects adding more than available stock', async () => {
    const user = await createUser();
    const productId = await makeProduct(3);

    const res = await request(app)
      .post('/api/v1/cart')
      .set(authHeader(user.token))
      .send({ productId, qty: 10 });

    expect(res.status).toBe(409);
  });

  it('rejects adding an out-of-stock product', async () => {
    const user = await createUser();
    const productId = await makeProduct(0);

    const res = await request(app)
      .post('/api/v1/cart')
      .set(authHeader(user.token))
      .send({ productId, qty: 1 });

    expect(res.status).toBe(409);
  });

  it('updates item quantity, rejecting a qty that exceeds stock', async () => {
    const user = await createUser();
    const productId = await makeProduct(5);

    const addRes = await request(app)
      .post('/api/v1/cart')
      .set(authHeader(user.token))
      .send({ productId, qty: 1 });
    const itemId = addRes.body.data.cart.items[0]._id;

    const okUpdate = await request(app)
      .patch(`/api/v1/cart/${itemId}`)
      .set(authHeader(user.token))
      .send({ qty: 4 });
    expect(okUpdate.status).toBe(200);
    expect(okUpdate.body.data.cart.items[0].qty).toBe(4);

    const tooMany = await request(app)
      .patch(`/api/v1/cart/${itemId}`)
      .set(authHeader(user.token))
      .send({ qty: 100 });
    expect(tooMany.status).toBe(409);
  });

  it('removes an item from the cart', async () => {
    const user = await createUser();
    const productId = await makeProduct(5);

    const addRes = await request(app)
      .post('/api/v1/cart')
      .set(authHeader(user.token))
      .send({ productId, qty: 1 });
    const itemId = addRes.body.data.cart.items[0]._id;

    const removeRes = await request(app)
      .delete(`/api/v1/cart/${itemId}`)
      .set(authHeader(user.token));

    expect(removeRes.status).toBe(200);
    expect(removeRes.body.data.cart.items).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/cart');
    expect(res.status).toBe(401);
  });

  it('merges a guest cart into the user cart on login, summing quantities for existing items', async () => {
    const user = await createUser();
    const productA = await makeProduct(10);
    const productB = await makeProduct(10);

    await request(app)
      .post('/api/v1/cart')
      .set(authHeader(user.token))
      .send({ productId: productA, qty: 1 });

    const mergeRes = await request(app)
      .post('/api/v1/cart/merge')
      .set(authHeader(user.token))
      .send({
        items: [
          { productId: productA, qty: 2 },
          { productId: productB, qty: 3 },
        ],
      });

    expect(mergeRes.status).toBe(200);
    const itemA = mergeRes.body.data.cart.items.find(
      (i: { product: string }) => i.product === productA,
    );
    const itemB = mergeRes.body.data.cart.items.find(
      (i: { product: string }) => i.product === productB,
    );
    expect(itemA.qty).toBe(3); // 1 (already in cart) + 2 (from guest cart)
    expect(itemB.qty).toBe(3);
  });
});
