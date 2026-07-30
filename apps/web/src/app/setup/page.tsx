import Link from "next/link";
import { redirect } from "next/navigation";
import {
  signupAccessMainClassName,
  signupAccessPageHeaderClassName,
  signupAuthPageStackClassName,
} from "@/app/access-layout";
import { isInstanceConfigured } from "@/server/instance-configured";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  if (await isInstanceConfigured()) {
    redirect("/login");
  }

  return (
    <main className={signupAccessMainClassName}>
      <div className={signupAuthPageStackClassName}>
        <header className={signupAccessPageHeaderClassName}>
          <div className="space-y-3">
            <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">
              Access
            </p>
            <h1 className="font-display text-display-md text-display">Set up 716fmpub</h1>
            <p className="font-sans text-body text-muted">
              Create the owner account for this self-hosted instance. Only one account is allowed.
            </p>
          </div>
          <nav className="font-mono text-caption uppercase tracking-[0.06em] text-muted">
            <Link href="/" className="text-interactive no-underline hover:underline">
              Home
            </Link>
          </nav>
        </header>
        <SetupForm />
      </div>
    </main>
  );
}
