import nodemailer, { Transporter } from 'nodemailer';
import { env } from './env';

/**
 * Cached at module scope so warm invocations (and every call within one
 * process) reuse the same SMTP connection pool instead of reconnecting.
 */
let transporter: Transporter | null = null;

/**
 * Returns null when SMTP isn't configured (e.g. local dev without an
 * EMAIL_HOST) so callers can fall back to a no-op instead of throwing —
 * mirrors the "optional integration" pattern used for Google SSO.
 */
export function getMailTransporter(): Transporter | null {
  if (!env.EMAIL_HOST || !env.EMAIL_USER || !env.EMAIL_PASSWORD) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.EMAIL_HOST,
      port: env.EMAIL_PORT,
      secure: env.EMAIL_SECURE,
      auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASSWORD },
      // nodemailer's defaults (2min connect / 10min socket) let a bad
      // network path block a request for far longer than an email is worth
      // — fail fast instead so a transient SMTP issue can't stall checkout,
      // registration, etc.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  return transporter;
}
