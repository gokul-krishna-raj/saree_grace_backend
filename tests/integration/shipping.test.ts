import { request, buildApp, createUser, authHeader } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';

// Pincodes resolve through the fixed directory mocked in tests/setup.ts.
const baseAddress = {
  fullName: 'Test Customer',
  phone: '9876543210',
  line1: '123 Main St',
  city: 'Somewhere',
  country: 'India',
};

async function cartWithOneItem(token: string, price = 1000) {
  const category = await Category.create({ name: 'Ship Cat', slug: `ship-cat-${Math.random()}` });
  const product = await Product.create({
    type: 'simple',
    name: 'Ship Product',
    slug: `ship-product-${Math.random()}`,
    description: 'desc',
    category: category._id,
    price,
    stock: 5,
  });
  await request(buildApp())
    .post('/api/v1/cart')
    .set(authHeader(token))
    .send({ productId: product._id.toString(), qty: 1 });
}

describe('Shipping', () => {
  const app = buildApp();

  describe('GET /shipping/quote', () => {
    it('quotes the fee and state for a pincode', async () => {
      const res = await request(app).get('/api/v1/shipping/quote?pincode=560001');
      expect(res.status).toBe(200);
      expect(res.body.data.quote).toEqual({
        pincode: '560001',
        state: 'Karnataka',
        fee: 60,
        source: 'pincode',
      });
    });

    it('rejects a malformed pincode', async () => {
      const res = await request(app).get('/api/v1/shipping/quote?pincode=06001');
      expect(res.status).toBe(400);
    });

    it('rejects an unknown pincode', async () => {
      const res = await request(app).get('/api/v1/shipping/quote?pincode=999999');
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/not found/i);
    });
  });

  describe('POST /orders', () => {
    it.each([
      ['605001', 'Puducherry', 40],
      ['682001', 'Kerala', 60],
      ['110001', 'Delhi', 130],
    ])('charges shipping from pincode %s (%s, ₹%i)', async (postalCode, state, fee) => {
      const user = await createUser();
      await cartWithOneItem(user.token, 1000);

      const res = await request(app)
        .post('/api/v1/orders')
        .set(authHeader(user.token))
        .send({ shippingAddress: { ...baseAddress, state, postalCode } });

      expect(res.status).toBe(201);
      expect(res.body.data.order.shippingFee).toBe(fee);
      expect(res.body.data.order.total).toBe(1000 + fee);
    });

    it('charges by the pincode even if the selected state is a cheaper tier', async () => {
      const user = await createUser();
      await cartWithOneItem(user.token);

      const res = await request(app)
        .post('/api/v1/orders')
        .set(authHeader(user.token))
        .send({ shippingAddress: { ...baseAddress, state: 'Tamil Nadu', postalCode: '110001' } });

      expect(res.status).toBe(201);
      expect(res.body.data.order.shippingFee).toBe(130);
    });

    it('refuses to create an order for an unknown pincode, leaving stock untouched', async () => {
      const user = await createUser();
      await cartWithOneItem(user.token);

      const res = await request(app)
        .post('/api/v1/orders')
        .set(authHeader(user.token))
        .send({ shippingAddress: { ...baseAddress, state: 'Tamil Nadu', postalCode: '999999' } });

      expect(res.status).toBe(400);
      const product = await Product.findOne({ name: 'Ship Product' });
      expect(product?.stock).toBe(5);
    });
  });
});
