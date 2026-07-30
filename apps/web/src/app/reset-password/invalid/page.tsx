import Link from "next/link";
import { AuthAccessPage } from "@/components/auth-access-page";
import { signupAccessPageSectionClassName } from "@/app/access-layout";

type Search = Promise<{ reason?: string }>;

function bodyCopy(reason: string | undefined): { lead: string; detail: string } {
  switch (reason) {
    case "malformed":
      return {
        lead: "This reset link is incomplete.",
        detail:
          "Copy the full address from the latest reset email, or request a new link from forgot password.",
      };
    case "replayed":
      return {
        lead: "This reset link was already used.",
        detail:
          "Each link works once. If you still need to change your password, request a new reset email.",
      };
    default:
      return {
        lead: "This reset link cannot be used.",
        detail:
          "The link may be mistyped, revoked, or replaced by a newer one. Request a fresh reset email and try again.",
      };
  }
}

export default async function ResetPasswordInvalidPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const { reason: raw } = await searchParams;
  const reason = typeof raw === "string" ? raw.trim() : "";
  const { lead, detail } = bodyCopy(reason.length > 0 ? reason : undefined);

  return (
    <AuthAccessPage overline="Access" title="Reset link unavailable">
      <div className={signupAccessPageSectionClassName}>
        <div className="space-y-4">
          <p className="font-sans text-body text-foreground">{lead}</p>
          <p className="font-sans text-body-sm text-muted">{detail}</p>
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
