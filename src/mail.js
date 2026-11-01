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
    "<p lang=\"zh-Hans\">你的鸭先知邮箱验证码是：</p><p lang=\"en\">Your Ponder verification code:</p><p style=\"font-size:28px;letter-spacing:6px\"><strong>" +
    String(code) +
    "</strong></p><p lang=\"zh-Hans\">用于验证邮箱或设置密码，10 分钟内有效。若不是你本人操作，请忽略；请勿转发给他人。</p><p lang=\"en\">Use this code to verify your email or set your password. It expires in 10 minutes. If you did not request it, ignore this email. Do not share this code.</p>"
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
      subject: "鸭先知 Ponder · 邮箱验证码 / Verification code",
      text: "鸭先知邮箱验证码 / Your Ponder verification code: " + String(code) +
        "\n\n用于验证邮箱或设置密码，10 分钟内有效。若不是你本人操作，请忽略；请勿转发给他人。" +
        "\n\nUse this code to verify your email or set your password. It expires in 10 minutes. If you did not request it, ignore this email. Do not share this code.",
      html: otpEmailHtml(code),
    }),
  });
  if (!res || !res.ok) {
    return { ok: false, error: "mail-http-" + (res && res.status), driver: "resend" };
  }
  return { ok: true, skipped: false, driver: "resend" };
}
