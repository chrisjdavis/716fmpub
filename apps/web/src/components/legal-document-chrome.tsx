import Link from "next/link";
import { PRODUCT_NAME } from "@vs/domain";
import homeStyles from "@/app/home-landing.module.css";
import { AppPrimaryNav } from "@/app/dashboard/app-primary-nav";
import { AppBrandMark } from "@/components/app-brand-mark";
import { PublicSiteHeaderNav } from "@/components/public-site-header-nav";
import { getServerSession } from "@/server/auth/get-server-session";

export async function LegalDocumentChrome({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-foreground">
      <header className="border-b border-hairline px-6 py-6 md:py-8">
        <div className="mx-auto flex min-w-0 max-w-app-content items-center justify-between gap-4">
          <Link
            href="/"
            className={`${homeStyles.brandLine} shrink-0 text-inherit no-underline hover:no-underline hover:opacity-90`}
          >
            <AppBrandMark />
            <span className={homeStyles.brandName}>{PRODUCT_NAME}</span>
          </Link>
          {session ? <AppPrimaryNav /> : <PublicSiteHeaderNav variant="compact" />}
        </div>
      </header>

      <main className="mx-auto flex w-full min-w-0 max-w-app-content flex-1 flex-col gap-10 px-6 py-12 md:py-16">
        {children}
      </main>
    </div>
  );
}
