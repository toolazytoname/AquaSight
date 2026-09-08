/** Pluggable OTP mailer. Cloudflare hosting is not an email sender. */

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function mailConfig(env = {}) {
  const driver = String(env.MAIL_DRIVER || process.env.MAIL_DRIVER || "").trim() ||
    (env.MAIL_API_KEY || process.env.MAIL_API_KEY ? "resend" : "log");
  return {
    driver,
    apiKey: env.MAIL_API_KEY || process.env.MAIL_API_KEY || "",
    from: env.MAIL_FROM || process.env.MAIL_FROM || "鸭先知 <noreply@localhost>",
  };
}

export function otpEmailHtml(code) {
  return (
    "<p>你的鸭先知登录验证码是：</p><p style=\"font-size:28px;letter-spacing:6px\"><strong>" +
    String(code) +
    "</strong></p><p>10 分钟内有效，请勿转发给他人。</p>"
  );
}

export async function sendOtpEmail({ to, code, env = {}, fetchImpl }) {
  const cfg = mailConfig(env);
  if (cfg.driver === "log" || !cfg.apiKey) {
    return { ok: true, skipped: true, driver: "log" };
  }
  if (cfg.driver !== "resend") {
    return { ok: false, error: "unsupported-mail-driver" };
  }
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + cfg.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: cfg.from,
      to: [to],
      subject: "鸭先知登录验证码",
      html: otpEmailHtml(code),
    }),
  });
  if (!res || !res.ok) {
    return { ok: false, error: "mail-http-" + (res && res.status), driver: "resend" };
  }
  return { ok: true, skipped: false, driver: "resend" };
}
