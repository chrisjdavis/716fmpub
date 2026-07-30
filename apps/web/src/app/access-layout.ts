/** Shared `<main>` shell for login, signup, verify-email, forgot-password, etc. */
export const signupAccessMainClassName =
  "mx-auto flex w-full min-h-screen max-w-auth-form flex-col px-6 py-16 md:py-24";

/**
 * Block stack (not flex): avoids shrink-to-fit width following the longest text line / hint.
 * Width is always the full `main` content box — never content-derived.
 */
export const signupAuthPageStackClassName = "w-full min-w-0 space-y-12";

/** Header block — same full width as the form column. */
export const signupAccessPageHeaderClassName = "w-full min-w-0 space-y-4";

/** Form block — full width; vertical rhythm only (not flex, so no intrinsic-width quirks). */
export const signupFormShellClassName = "w-full min-w-0 space-y-8";

/** Prose + CTAs — full width of parent. */
export const signupAccessPageSectionClassName = "w-full min-w-0 space-y-10";

export const signupAccessPageSectionCompactClassName = "w-full min-w-0 space-y-6";
