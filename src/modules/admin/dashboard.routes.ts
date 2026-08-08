import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { getDashboardSummary } from './dashboard.service';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const summary = await getDashboardSummary();
    sendSuccess(res, summary);
  }),
);

export default router;
