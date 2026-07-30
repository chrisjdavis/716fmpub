import Link from "next/link";
import { AuthAccessPage } from "@/components/auth-access-page";
import { signupAccessPageSectionClassName } from "@/app/access-layout";

export default function ResetPasswordExpiredPage() {
  return (
    <AuthAccessPage overline="Access" title="Reset link expired">
      <div className={signupAccessPageSectionClassName}>
        <div className="space-y-4">
          <p className="font-sans text-body text-foreground">
            Password reset links only work for a short time. Request a new link and open it from
            your latest email.
          </p>
          <p className="font-sans text-body-sm text-muted">
            Older messages in the thread may still contain links that are no longer valid.
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
          <Link href="/forgot-password" className="vs-btn-primary">
            Request new link
          </Link>
          <Link
            href="/login"
            className="font-mono text-label uppercase tracking-[0.08em] text-interactive no-underline hover:underline"
          >
            Sign in
          </Link>
        </div>
      </div>
    </AuthAccessPage>
  );
}
