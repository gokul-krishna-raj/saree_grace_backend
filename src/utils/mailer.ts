import { getMailTransporter } from '../config/mailer';
import { env } from '../config/env';
import { logger } from './logger';

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sends via the configured SMTP transporter (nodemailer). Falls back to a
 * stub log when EMAIL_* isn't configured (e.g. local dev) instead of
 * throwing — mirrors how Google SSO degrades when unconfigured.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const transporter = getMailTransporter();
  if (!transporter) {
    logger.info('Email (stubbed, not actually sent — EMAIL_* not configured)', {
      to,
      subject,
      html,
    });
    return;
  }

  await transporter.sendMail({
    from: `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_FROM_ADDRESS}>`,
    to,
    subject,
    html,
    text: stripHtml(html),
  });
  logger.info('Email sent', { to, subject });
}
