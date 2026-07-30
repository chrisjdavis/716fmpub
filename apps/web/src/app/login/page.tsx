import Link from "next/link";
import { redirect } from "next/navigation";
import {
  signupAccessMainClassName,
  signupAccessPageHeaderClassName,
  signupAuthPageStackClassName,
} from "@/app/access-layout";
import { PublicListeningAuthNavPrefix } from "@/components/public-site-header-nav";
import { isInstanceConfigured } from "@/server/instance-configured";
import { LoginForm } from "./login-form";

function sanitizeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }
  return next;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; recovered?: string }>;
}) {
  if (!(await isInstanceConfigured())) {
    redirect("/setup");
  }

  const { next, recovered } = await searchParams;
  const nextPath = sanitizeNext(next);
  const showRecoveryNotice = recovered === "1";

  return (
    <main className={signupAccessMainClassName}>
      <div className={signupAuthPageStackClassName}>
        <header className={signupAccessPageHeaderClassName}>
          <div className="space-y-3">
            <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">
              Access
            </p>
            <h1 className="font-display text-display-md text-display">Sign in</h1>
          </div>
          <nav className="font-mono text-caption uppercase tracking-[0.06em] text-muted">
            <PublicListeningAuthNavPrefix />
            <Link href="/" className="text-interactive no-underline hover:underline">
              Home
            </Link>
            <span className="mx-2 text-faint">/</span>
            <Link
              href="/forgot-password"
              className="text-interactive no-underline hover:underline"
            >
              Forgot password
            </Link>
          </nav>
        </header>
        {showRecoveryNotice ? (
          <p
            className="font-mono text-caption uppercase tracking-[0.04em] text-muted"
            role="status"
          >
            Password updated. Previous sign-ins for this account are no longer active. Sign in with
            your new password.
          </p>
        ) : null}
        <LoginForm nextPath={nextPath} />
      </div>
    </main>
  );
}
