import { logger } from './logger';

/**
 * Stubbed email sender. Swap this for SES/SendGrid/etc. in production —
 * the call sites (password reset) are already isolated behind this
 * single function so that's a one-file change.
 */
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  logger.info('Email (stubbed, not actually sent)', { to, subject, body });
  return Promise.resolve();
}

export function buildPasswordResetEmailBody(resetUrl: string): string {
  return `You requested a password reset. Use the link below (valid for a limited time):\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`;
}
