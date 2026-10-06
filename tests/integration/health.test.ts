import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../src/app';

describe('GET /health', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns ok status after a real database ping', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.db).toBe('connected');
    expect(typeof res.body.data.dbLatencyMs).toBe('number');
  });

  it('returns 500 when the database ping fails', async () => {
    const db = mongoose.connection.db!;
    const admin = db.admin();
    jest.spyOn(db, 'admin').mockReturnValue({
      ...admin,
      ping: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as ReturnType<typeof db.admin>);

    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
