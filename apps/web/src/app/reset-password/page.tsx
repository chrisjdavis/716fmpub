import { getPool, inspectPasswordRecoveryToken } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { redirect } from "next/navigation";
import { AuthAccessPage } from "@/components/auth-access-page";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token: raw } = await searchParams;
  const token = typeof raw === "string" ? raw.trim() : "";

  if (token.length === 0) {
    redirect("/reset-password/invalid?reason=malformed");
  }
  if (token.length < 32) {
    redirect("/reset-password/invalid?reason=malformed");
  }

  const env = loadServerEnv();
  const pool = getPool(env);
  const inspected = await inspectPasswordRecoveryToken(pool, { rawToken: token });
  if (!inspected.ok) {
    if (inspected.reason === "expired") {
      redirect("/reset-password/expired");
    }
    const reason = inspected.reason === "replayed" ? "replayed" : "invalid";
    redirect(`/reset-password/invalid?reason=${reason}`);
  }

  return (
    <AuthAccessPage overline="Access" title="Reset password">
      <ResetPasswordForm token={token} />
    </AuthAccessPage>
  );
}
