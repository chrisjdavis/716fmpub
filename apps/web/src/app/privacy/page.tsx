import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT_NAME } from "@vs/domain";
import { LegalDocumentChrome } from "@/components/legal-document-chrome";
import { getServerSession } from "@/server/auth/get-server-session";

export const metadata: Metadata = {
  title: `Privacy policy — ${PRODUCT_NAME}`,
  description: `How 716 Ventures, LLC collects, uses, and protects information when you use ${PRODUCT_NAME}.`,
};

const effectiveDate = "April 23, 2026";

export default async function PrivacyPage() {
  const session = await getServerSession();
  const settingsHref = session
    ? "/dashboard/settings"
    : "/login?next=%2Fdashboard%2Fsettings";

  return (
    <LegalDocumentChrome>
      <header className="max-w-full space-y-3">
        <h1 className="font-display text-display-md text-display">Privacy policy</h1>
        <p className="font-sans text-body text-muted">
          Effective {effectiveDate}. This policy describes how 716 Ventures, LLC (&quot;we,&quot;
          &quot;us,&quot; or &quot;our&quot;) handles information when you use {PRODUCT_NAME} (the
          &quot;Service&quot;).
        </p>
      </header>

      <article className="max-w-full divide-y divide-hairline font-sans text-body text-foreground">
        <section className="space-y-3 pb-10 pt-0" aria-labelledby="privacy-collect">
          <h2 id="privacy-collect" className="font-display text-heading text-display">
            Information we collect
          </h2>
          <ul className="m-0 list-disc space-y-2 pl-5 text-muted">
            <li>
              <span className="text-foreground">Account data:</span> such as email address,
              password hash, and profile details you provide.
            </li>
            <li>
              <span className="text-foreground">Listening and import data:</span> information you
              import or sync, including timestamps, titles, artists, and related metadata needed to
              provide analytics and features.
            </li>
            <li>
              <span className="text-foreground">Usage and technical data:</span> such as device
              type, browser type, approximate location derived from IP where needed for security,
              log data, diagnostics, and interactions with the Service.
            </li>
            <li>
              <span className="text-foreground">Support communications:</span> messages you send us
              and information needed to respond.
            </li>
          </ul>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="privacy-use">
          <h2 id="privacy-use" className="font-display text-heading text-display">
            How we use information
          </h2>
          <p className="m-0 text-muted">
            We use information to provide, maintain, and improve the Service; authenticate users;
            process imports and exports; secure accounts; detect and prevent fraud and abuse; comply
            with law; communicate about the Service; and understand aggregate usage trends. We do not
            sell your personal information.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="privacy-legal-bases">
          <h2 id="privacy-legal-bases" className="font-display text-heading text-display">
            Legal bases (where applicable)
          </h2>
          <p className="m-0 text-muted">
            If data protection laws such as the GDPR apply, we rely on appropriate bases including
            contract (to provide the Service you request), legitimate interests (for example,
            security, product improvement, and internal analytics that are not overridden by your
            rights), consent where required, and legal obligation.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="privacy-sharing">
          <h2 id="privacy-sharing" className="font-display text-heading text-display">
            Sharing and processors
          </h2>
          <p className="m-0 text-muted">
            We share information with service providers that host infrastructure, send email, or
            perform other processing on our instructions, subject to confidentiality and security
            obligations. We may disclose information if required by law, to protect rights and
            safety, or as part of a merger, acquisition, or asset sale (with notice where required).
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="privacy-retention">
          <h2 id="privacy-retention" className="font-display text-heading text-display">
            Retention
          </h2>
          <p className="m-0 text-muted">
            We retain information for as long as needed to provide the Service, comply with legal
            obligations, resolve disputes, and enforce agreements. Retention periods can vary based
            on the type of data and operational needs.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="privacy-security">
          <h2 id="privacy-security" className="font-display text-heading text-display">
            Security
          </h2>
          <p className="m-0 text-muted">
            We implement technical and organizational measures designed to protect information.
            No method of transmission or storage is completely secure; we cannot guarantee absolute
            security.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="privacy-rights">
          <h2 id="privacy-rights" className="font-display text-heading text-display">
            Your choices and rights
          </h2>
          <p className="m-0 text-muted">
            Depending on your location, you may have rights to access, correct, delete, or export
            personal information, or to object to or restrict certain processing. You can manage
            some information in{" "}
            <Link href={settingsHref} className="text-interactive no-underline hover:underline">
              Settings
            </Link>
            {session ? "" : " after you sign in"}
            . You may also contact us using the support channels we publish. We will respond in line
            with applicable law.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="privacy-children">
          <h2 id="privacy-children" className="font-display text-heading text-display">
            Children
          </h2>
          <p className="m-0 text-muted">
            The Service is not directed to children under 13 (or the age required by local law), and
            we do not knowingly collect personal information from children. If you believe we have
            collected information from a child, contact us and we will take appropriate steps.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="privacy-international">
          <h2 id="privacy-international" className="font-display text-heading text-display">
            International transfers
          </h2>
          <p className="m-0 text-muted">
            We may process information in the United States and other countries where we or our
            providers operate. Where required, we use appropriate safeguards for cross-border
            transfers.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="privacy-changes">
          <h2 id="privacy-changes" className="font-display text-heading text-display">
            Changes to this policy
          </h2>
          <p className="m-0 text-muted">
            We may update this policy from time to time. We will post the updated policy on this
            page and revise the effective date. For material changes, we will provide additional
            notice as required by law.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="privacy-contact">
          <h2 id="privacy-contact" className="font-display text-heading text-display">
            Contact
          </h2>
          <p className="m-0 text-muted">
            For privacy-related requests, contact us using the support channels we publish for{" "}
            {PRODUCT_NAME}.
          </p>
        </section>

        <p className="m-0 py-10 font-mono text-caption uppercase tracking-[0.06em] text-muted">
          Related:{" "}
          <Link href="/terms" className="text-interactive no-underline hover:underline">
            Terms of use
          </Link>
        </p>
      </article>
    </LegalDocumentChrome>
  );
}
