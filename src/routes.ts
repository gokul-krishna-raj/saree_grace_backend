import { Router } from 'express';
import healthRoutes from './modules/health/health.routes';
import authRoutes from './modules/auth/auth.routes';
import categoryRoutes from './modules/category/category.routes';
import productRoutes from './modules/product/product.routes';
import adminProductRoutes from './modules/product/admin-product.routes';
import cartRoutes from './modules/cart/cart.routes';
import wishlistRoutes from './modules/wishlist/wishlist.routes';
import orderRoutes from './modules/order/order.routes';
import adminOrderRoutes from './modules/order/admin-order.routes';
import paymentRoutes from './modules/payment/payment.routes';
import reviewRoutes from './modules/review/review.routes';
import adminReviewRoutes from './modules/review/admin-review.routes';
import adminDashboardRoutes from './modules/admin/dashboard.routes';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/categories', categoryRoutes);
router.use('/products', productRoutes);
router.use('/admin/products', adminProductRoutes);
router.use('/cart', cartRoutes);
router.use('/wishlist', wishlistRoutes);
router.use('/orders', orderRoutes);
router.use('/admin/orders', adminOrderRoutes);
router.use('/payments', paymentRoutes);
router.use('/reviews', reviewRoutes);
router.use('/admin/reviews', adminReviewRoutes);
router.use('/admin/dashboard', adminDashboardRoutes);

export default router;
