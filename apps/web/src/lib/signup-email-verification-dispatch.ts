/** Public signup JSON: deterministic outcome for verification email dispatch (no secrets). */
export type SignupEmailVerificationDispatch =
  | { status: "sent" }
  | {
      status: "skipped";
      reason: "email_not_configured" | "public_app_origin_missing";
    }
  | { status: "failed"; reason: "provider_error" };
