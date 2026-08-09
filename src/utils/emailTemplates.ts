/**
 * Plain HTML string templates (no templating engine — these are small and
 * static enough that one isn't worth the dependency). Styles are inlined
 * since most email clients strip <style> blocks.
 */

export function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f6f1ec;font-family:Georgia,'Times New Roman',serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f1ec;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background-color:#7a1f2b;padding:24px 32px;">
                <span style="color:#ffffff;font-size:20px;letter-spacing:1px;">Saree Grace</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#2b2b2b;font-size:15px;line-height:1.6;">
                <h1 style="margin:0 0 16px;font-size:18px;color:#7a1f2b;">${title}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px;color:#9a9a9a;font-size:12px;">
                If you did not request this, you can safely ignore this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function otpEmailTemplate(
  otp: string,
  expiryMinutes: number,
): { subject: string; html: string } {
  const subject = 'Verify your Saree Grace account';
  const html = layout(
    'Verify your email',
    `<p>Your verification code is:</p>
     <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#7a1f2b;margin:16px 0;">${otp}</p>
     <p>This code expires in ${expiryMinutes} minutes.</p>`,
  );
  return { subject, html };
}

export function passwordResetEmailTemplate(resetUrl: string): { subject: string; html: string } {
  const subject = 'Reset your Saree Grace password';
  const html = layout(
    'Reset your password',
    `<p>We received a request to reset your password. This link is valid for a limited time:</p>
     <p style="margin:24px 0;">
       <a href="${resetUrl}" style="background-color:#7a1f2b;color:#ffffff;padding:12px 24px;border-radius:4px;text-decoration:none;display:inline-block;">Reset password</a>
     </p>
     <p style="color:#6b6b6b;font-size:13px;">Or copy this link into your browser: ${resetUrl}</p>`,
  );
  return { subject, html };
}
