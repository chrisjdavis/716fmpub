import Link from "next/link";
import { AuthAccessPage } from "@/components/auth-access-page";
import { signupAccessPageSectionClassName } from "@/app/access-layout";

export default function ResetPasswordCompletePage() {
  return (
    <AuthAccessPage overline="Access" title="Next step after reset">
      <div className={signupAccessPageSectionClassName}>
        <div className="space-y-4">
          <p className="font-sans text-body text-foreground">
            If you just finished changing your password on the previous screen, your new password is
            the one to use at sign-in. When a reset completes successfully, earlier sign-ins for that
            account are ended as part of the same process.
          </p>
          <p className="font-sans text-body-sm text-muted">
            If you opened this page by mistake or from a bookmark and you did not reset just now,
            you can ignore it or go back to sign in. Nothing on this page changes your account by
            itself.
          </p>
        </div>
        <Link href="/login" className="vs-btn-primary">
          Sign in
        </Link>
      </div>
    </AuthAccessPage>
  );
}
