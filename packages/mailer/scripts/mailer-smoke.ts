import { loadServerEnv } from "@vs/env";
import { createMailgunMailerFromServerEnv } from "../src/create-mailgun-mailer-from-server-env.js";
import { renderOperatorMailgunSmokeEmail } from "../src/transactional/operator-smoke-email.js";

/**
 * Operator smoke path: validates env + factory; optionally performs a real Mailgun POST.
 *
 * - Requires the same `.env` contract as other services (`dotenv -e .env` from repo root).
 * - Set `MAILER_SMOKE_TO` and `MAILER_SMOKE_DISPATCH=true` to send one message.
 */
async function main(): Promise<void> {
  const env = loadServerEnv();
  const mailer = createMailgunMailerFromServerEnv(env);
  if (!mailer) {
    console.log("[mailer:smoke] Outbound email is disabled (VS_EMAIL_ENABLED is not true).");
    process.exit(0);
  }

  const transport = env.emailTransport ?? "unknown";
  if (transport !== "mailgun") {
    console.log(
      `[mailer:smoke] Outbound transport is "${transport}" (no Mailgun HTTP). Captured/noop mailers exercise templates and logging only.`,
    );
  }

  const to = process.env.MAILER_SMOKE_TO?.trim();
  const dispatch = process.env.MAILER_SMOKE_DISPATCH === "true";

  if (!to) {
    console.log(
      "[mailer:smoke] Mailer is configured. Set MAILER_SMOKE_TO=recipient@example.com to target a recipient.",
    );
    console.log(
      "[mailer:smoke] Set MAILER_SMOKE_DISPATCH=true to dispatch (capture/noop: in-process only; mailgun: real Mailgun POST when transport is mailgun).",
    );
    process.exit(0);
  }

  if (!dispatch) {
    console.log(
      `[mailer:smoke] Dry run only: would send a smoke message to ${to}. Set MAILER_SMOKE_DISPATCH=true to dispatch.`,
    );
    process.exit(0);
  }

  if (transport === "mailgun") {
    console.log("[mailer:smoke] Performing Mailgun HTTP POST (transport=mailgun).");
  } else {
    console.log(`[mailer:smoke] Dispatch with transport="${transport}" (no external Mailgun HTTP).`);
  }

  const smoke = renderOperatorMailgunSmokeEmail(
    {
      appName: "716FM",
      publicOrigin: env.publicAppOrigin ?? "https://localhost",
    },
    { to },
  );
  const result = await mailer.sendEmail({
    to: smoke.to,
    subject: smoke.subject,
    text: smoke.text,
    html: smoke.html,
  });
  console.log(`[mailer:smoke] Sent. Provider message id: ${result.providerMessageId}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
