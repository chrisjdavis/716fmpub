import { redirect } from "next/navigation";
import { getServerSession } from "@/server/auth/get-server-session";

/**
 * Guided Last.fm setup runs on `/dashboard` while the account shell is locked. This route stays as
 * a stable entry point for older links and forwards there.
 */
export default async function OnboardingLayout({
  children: _children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getServerSession();
  if (!session) {
    redirect("/login?next=%2Fonboarding");
  }
  redirect("/dashboard");
}
