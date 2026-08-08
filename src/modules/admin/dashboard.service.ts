import { Order } from '../../models/Order';
import { Product } from '../../models/Product';

const LOW_STOCK_THRESHOLD = 5;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d;
}

function startOfMonth(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

export interface DashboardSummary {
  orderCountsByStatus: Record<string, number>;
  revenue: { today: number; week: number; month: number };
  lowStockProducts: Array<{ id: string; name: string; sku?: string; stock: number }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    total: number;
    status: string;
    createdAt: Date;
  }>;
}

export async function getDashboardSummary(now: Date = new Date()): Promise<DashboardSummary> {
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  const [statusCounts, revenueBuckets, lowStockSimple, lowStockVariants, recentOrders] =
    await Promise.all([
      Order.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Order.aggregate<{ _id: null; today: number; week: number; month: number }>([
        { $match: { status: { $in: ['paid', 'processing', 'shipped', 'delivered'] } } },
        {
          $group: {
            _id: null,
            today: {
              $sum: { $cond: [{ $gte: ['$createdAt', todayStart] }, '$total', 0] },
            },
            week: {
              $sum: { $cond: [{ $gte: ['$createdAt', weekStart] }, '$total', 0] },
            },
            month: {
              $sum: { $cond: [{ $gte: ['$createdAt', monthStart] }, '$total', 0] },
            },
          },
        },
      ]),
      Product.find({ type: 'simple', isActive: true, stock: { $lte: LOW_STOCK_THRESHOLD } })
        .select('name sku stock')
        .limit(20)
        .lean(),
      Product.aggregate<{ _id: unknown; name: string; sku: string; stock: number }>([
        { $match: { type: 'variant', isActive: true } },
        { $unwind: '$variants' },
        { $match: { 'variants.isActive': true, 'variants.stock': { $lte: LOW_STOCK_THRESHOLD } } },
        {
          $project: {
            _id: '$variants._id',
            name: 1,
            sku: '$variants.sku',
            stock: '$variants.stock',
          },
        },
        { $limit: 20 },
      ]),
      Order.find().sort({ _id: -1 }).limit(10).select('orderNumber total status createdAt').lean(),
    ]);

  const orderCountsByStatus: Record<string, number> = {};
  for (const bucket of statusCounts) {
    orderCountsByStatus[bucket._id] = bucket.count;
  }

  const revenue = revenueBuckets[0] ?? { today: 0, week: 0, month: 0 };

  const lowStockProducts = [
    ...lowStockSimple.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      sku: p.sku,
      stock: p.stock ?? 0,
    })),
    ...lowStockVariants.map((v) => ({
      id: String(v._id),
      name: v.name,
      sku: v.sku,
      stock: v.stock,
    })),
  ];

  return {
    orderCountsByStatus,
    revenue: { today: revenue.today, week: revenue.week, month: revenue.month },
    lowStockProducts,
    recentOrders: recentOrders.map((o) => ({
      id: o._id.toString(),
      orderNumber: o.orderNumber,
      total: o.total,
      status: o.status,
      createdAt: o.createdAt,
    })),
  };
}
