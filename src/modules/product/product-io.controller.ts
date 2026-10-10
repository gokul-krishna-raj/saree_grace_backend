import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { logger } from '../../utils/logger';
import * as productIoService from './product-io.service';
import { ProductImportCommitInput, ProductImportPreviewInput } from './product.validation';

// CSV downloads are files, not JSON — the one place admin product routes
// bypass sendSuccess. Errors still go through asyncHandler → errorHandler.
function sendCsv(res: Response, csv: string, filename: string): void {
  res
    .status(200)
    .set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    })
    .send(csv);
}

export const exportProducts = asyncHandler(async (_req: Request, res: Response) => {
  const csv = await productIoService.exportProductsCsv();
  sendCsv(res, csv, productIoService.exportFilename());
});

export const getImportTemplate = asyncHandler(async (_req: Request, res: Response) => {
  const csv = await productIoService.buildImportTemplateCsv();
  sendCsv(res, csv, 'sareegrace-products-template.csv');
});

export const previewImport = asyncHandler(async (req: Request, res: Response) => {
  const { csv } = req.body as ProductImportPreviewInput;
  const preview = await productIoService.previewProductImport(csv);
  sendSuccess(res, preview);
});

export const commitImport = asyncHandler(async (req: Request, res: Response) => {
  const { csv, keys } = req.body as ProductImportCommitInput;
  const results = await productIoService.commitProductImport(csv, keys);
  const count = (status: productIoService.CommitStatus) =>
    results.filter((r) => r.status === status).length;
  logger.info('Product import committed', {
    adminId: req.user?.id,
    requested: keys.length,
    created: count('created'),
    updated: count('updated'),
    unchanged: count('unchanged'),
    failed: count('failed'),
    skipped: count('skipped'),
  });
  sendSuccess(res, { results });
});
