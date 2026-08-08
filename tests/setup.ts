process.env.NODE_ENV = 'test';
// Placeholder to satisfy env validation at import time — the actual
// connection below points at the in-memory replica set started in
// beforeAll(), not at this URI.
process.env.MONGODB_URI =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/saree_grace_test_placeholder';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? 'http://localhost:3000';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-please-ignore';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-please-ignore';
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? 'rzp_test_dummy';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? 'dummy_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? 'dummy_webhook_secret';
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME ?? 'test-cloud';
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY ?? 'test-key';
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET ?? 'test-secret';
process.env.GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ?? 'test-client-id.apps.googleusercontent.com';
// Rate limiters are created once at module-load time and share state across
// every `createApp()` call in a test file (they're not per-app instances) —
// use generous limits under test so unrelated tests don't 429 each other.
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX ?? '100000';
process.env.AUTH_RATE_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX ?? '100000';
process.env.PAYMENT_RATE_LIMIT_MAX = process.env.PAYMENT_RATE_LIMIT_MAX ?? '100000';

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let replSet: MongoMemoryReplSet | undefined;

jest.mock('../src/utils/cloudinaryUpload', () => ({
  uploadBufferToCloudinary: jest.fn().mockImplementation(async () => ({
    url: 'https://res.cloudinary.com/test/image/upload/mock.jpg',
    publicId: `mock-public-id-${Math.random().toString(36).slice(2)}`,
    width: 800,
    height: 800,
  })),
  deleteCloudinaryImage: jest.fn().mockResolvedValue(undefined),
  deleteCloudinaryImages: jest.fn().mockResolvedValue(undefined),
}));

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
}, 120000);

afterEach(async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
  }
});
