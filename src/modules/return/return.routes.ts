import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import * as returnController from './return.controller';
import {
  createReturnRequestSchema,
  returnIdParamSchema,
  listReturnsQuerySchema,
} from './return.validation';

const router = Router();

router.use(requireAuth);

router.post(
  '/',
  validate({ body: createReturnRequestSchema }),
  returnController.createReturnRequest,
);
router.get('/my', validate({ query: listReturnsQuerySchema }), returnController.listMyReturns);
router.get('/:id', validate({ params: returnIdParamSchema }), returnController.getMyReturn);

export default router;
