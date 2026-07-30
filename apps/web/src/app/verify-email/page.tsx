import Link from "next/link";
import {
  signupAccessMainClassName,
  signupAccessPageHeaderClassName,
  signupAuthPageStackClassName,
  signupFormShellClassName,
} from "@/app/access-layout";
import { PublicListeningAuthNavPrefix } from "@/components/public-site-header-nav";
import { VerifyEmailClient } from "./verify-email-client";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token: raw } = await searchParams;
  const token = typeof raw === "string" ? raw.trim() : "";

  return (
    <main className={signupAccessMainClassName}>
      <div className={signupAuthPageStackClassName}>
        <header className={signupAccessPageHeaderClassName}>
          <div className="space-y-3">
            <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">Account</p>
            <h1 className="font-display text-display-md text-display">Confirm email</h1>
          </div>
          <nav className="font-mono text-caption uppercase tracking-[0.06em] text-muted">
            <PublicListeningAuthNavPrefix />
            <Link href="/" className="text-interactive no-underline hover:underline">
              Home
            </Link>
          </nav>
        </header>
        {token.length >= 32 ? (
          <VerifyEmailClient token={token} />
        ) : (
          <div className={signupFormShellClassName}>
            <div className="space-y-4">
              <p className="font-display text-display-md text-display">Confirmation link incomplete</p>
              <p className="font-sans text-body text-foreground">
                Open the full address from your verification email, including everything after{" "}
                <span className="font-mono text-body-sm text-muted">token=</span>. If you already
                verified, sign in and continue from the dashboard.
              </p>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
              <Link href="/login" className="vs-btn-primary">
                Sign in
              </Link>
              <Link
                href="/login"
                className="font-mono text-label uppercase tracking-[0.08em] text-interactive no-underline hover:underline"
              >
                Create an account
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
