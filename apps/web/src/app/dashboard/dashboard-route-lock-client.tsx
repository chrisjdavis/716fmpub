"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keeps locked accounts on `/dashboard` when client-side navigation targets other dashboard URLs. */
export function DashboardRouteLockClient({
  locked,
  children,
}: Readonly<{
  locked: boolean;
  children: React.ReactNode;
}>) {
  const pathname = usePathname() ?? "";
  const router = useRouter();

  useEffect(() => {
    if (!locked) {
      return;
    }
    if (pathname === "/dashboard") {
      return;
    }
    if (!pathname.startsWith("/dashboard")) {
      return;
    }
    router.replace("/dashboard");
  }, [locked, pathname, router]);

  return children;
}
