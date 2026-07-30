import Link from "next/link";
import {
  signupAccessMainClassName,
  signupAccessPageHeaderClassName,
  signupAuthPageStackClassName,
} from "@/app/access-layout";
import { PublicListeningAuthNavPrefix } from "@/components/public-site-header-nav";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage() {
  return (
    <main className={signupAccessMainClassName}>
      <div className={signupAuthPageStackClassName}>
        <header className={signupAccessPageHeaderClassName}>
          <div className="space-y-3">
            <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">
              Access
            </p>
            <h1 className="font-display text-display-md text-display">Forgot password</h1>
          </div>
          <nav className="font-mono text-caption uppercase tracking-[0.06em] text-muted">
            <PublicListeningAuthNavPrefix />
            <Link href="/" className="text-interactive no-underline hover:underline">
              Home
            </Link>
            <span className="mx-2 text-faint">/</span>
            <Link href="/login" className="text-interactive no-underline hover:underline">
              Sign in
            </Link>
          </nav>
        </header>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
