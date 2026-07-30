import Link from "next/link";
import { AuthAccessPage } from "@/components/auth-access-page";
import { signupAccessPageSectionClassName } from "@/app/access-layout";

export default function ForgotPasswordSentPage() {
  return (
    <AuthAccessPage overline="Access" title="Check your email">
      <div className={signupAccessPageSectionClassName}>
        <div className="space-y-4">
          <p className="font-sans text-body text-foreground">
            If an account matches the address you entered, we sent a password reset link. The email
            may take a minute to arrive.
          </p>
          <p className="font-sans text-body-sm text-secondary">
            Did not request this? You can close this page. Your password stays the same until you
            complete the link from your inbox.
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
          <Link href="/forgot-password" className="vs-btn-primary">
            Send another link
          </Link>
          <Link
            href="/login"
            className="font-mono text-label uppercase tracking-[0.08em] text-interactive no-underline hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </AuthAccessPage>
  );
}
