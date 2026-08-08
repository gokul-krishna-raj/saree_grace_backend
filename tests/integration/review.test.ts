import { request, buildApp, createUser, createAdmin, authHeader } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';
import { Order } from '../../src/models/Order';

async function makeDeliveredOrder(userId: string, productId: string): Promise<string> {
  const order = await Order.create({
    orderNumber: `SG-TEST-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    user: userId,
    items: [
      {
        product: productId,
        variantId: null,
        nameSnapshot: 'Test Product',
        priceSnapshot: 500,
        qty: 1,
      },
    ],
    shippingAddress: {
      fullName: 'Reviewer',
      phone: '9876543210',
      line1: '1 Main St',
      city: 'Chennai',
      state: 'Tamil Nadu',
      postalCode: '600001',
      country: 'India',
    },
    itemsTotal: 500,
    shippingFee: 0,
    total: 500,
    status: 'delivered',
    statusHistory: [{ status: 'delivered', changedAt: new Date() }],
  });
  return order._id.toString();
}

async function makeProduct(): Promise<string> {
  const category = await Category.create({
    name: 'Review Cat',
    slug: `review-cat-${Date.now()}-${Math.random()}`,
  });
  const product = await Product.create({
    type: 'simple',
    name: 'Reviewed Product',
    slug: `reviewed-product-${Date.now()}-${Math.random()}`,
    description: 'desc',
    category: category._id,
    price: 500,
    stock: 5,
  });
  return product._id.toString();
}

describe('Reviews', () => {
  const app = buildApp();

  it('rejects a review when the user has not purchased (delivered) the product', async () => {
    const user = await createUser();
    const productId = await makeProduct();

    const res = await request(app)
      .post('/api/v1/reviews')
      .set(authHeader(user.token))
      .field('productId', productId)
      .field('orderId', '507f1f77bcf86cd799439011')
      .field('rating', '5')
      .field('comment', 'Great product!');

    expect(res.status).toBe(403);
  });

  it('allows a review from a verified delivered order and hides it until approved', async () => {
    const user = await createUser();
    const productId = await makeProduct();
    const orderId = await makeDeliveredOrder(user.id, productId);

    const createRes = await request(app)
      .post('/api/v1/reviews')
      .set(authHeader(user.token))
      .field('productId', productId)
      .field('orderId', orderId)
      .field('rating', '4')
      .field('comment', 'Pretty good saree');

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.review.approved).toBe(false);

    const publicRes = await request(app).get(`/api/v1/products/${productId}/reviews`);
    expect(publicRes.body.data.reviews).toHaveLength(0);
  });

  it('shows a review publicly once an admin approves it, and recalculates product rating', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const productId = await makeProduct();
    const orderId = await makeDeliveredOrder(user.id, productId);

    const createRes = await request(app)
      .post('/api/v1/reviews')
      .set(authHeader(user.token))
      .field('productId', productId)
      .field('orderId', orderId)
      .field('rating', '5')
      .field('comment', 'Excellent!');
    const reviewId = createRes.body.data.review._id;

    const approveRes = await request(app)
      .patch(`/api/v1/admin/reviews/${reviewId}/approve`)
      .set(authHeader(admin.token));
    expect(approveRes.status).toBe(200);

    const publicRes = await request(app).get(`/api/v1/products/${productId}/reviews`);
    expect(publicRes.body.data.reviews).toHaveLength(1);

    const product = await Product.findById(productId);
    expect(product?.ratingAvg).toBe(5);
    expect(product?.reviewCount).toBe(1);
  });

  it('rejects a second review for the same order+product', async () => {
    const user = await createUser();
    const productId = await makeProduct();
    const orderId = await makeDeliveredOrder(user.id, productId);

    await request(app)
      .post('/api/v1/reviews')
      .set(authHeader(user.token))
      .field('productId', productId)
      .field('orderId', orderId)
      .field('rating', '3')
      .field('comment', 'Okay');

    const res = await request(app)
      .post('/api/v1/reviews')
      .set(authHeader(user.token))
      .field('productId', productId)
      .field('orderId', orderId)
      .field('rating', '5')
      .field('comment', 'Changed my mind');

    expect(res.status).toBe(409);
  });

  it('admin can list all reviews including unapproved ones, and delete a review', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const productId = await makeProduct();
    const orderId = await makeDeliveredOrder(user.id, productId);

    const createRes = await request(app)
      .post('/api/v1/reviews')
      .set(authHeader(user.token))
      .field('productId', productId)
      .field('orderId', orderId)
      .field('rating', '2')
      .field('comment', 'Not great');

    const listRes = await request(app)
      .get('/api/v1/admin/reviews')
      .set(authHeader(admin.token))
      .query({ approved: 'false' });
    expect(listRes.body.data.reviews.length).toBeGreaterThanOrEqual(1);

    const deleteRes = await request(app)
      .delete(`/api/v1/admin/reviews/${createRes.body.data.review._id}`)
      .set(authHeader(admin.token));
    expect(deleteRes.status).toBe(200);
  });
});
