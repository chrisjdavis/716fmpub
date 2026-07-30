import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT_NAME } from "@vs/domain";
import { LegalDocumentChrome } from "@/components/legal-document-chrome";

export const metadata: Metadata = {
  title: `Terms of use — ${PRODUCT_NAME}`,
  description: `Terms governing use of ${PRODUCT_NAME} and related services operated by 716 Ventures, LLC.`,
};

const effectiveDate = "April 23, 2026";

export default function TermsPage() {
  return (
    <LegalDocumentChrome>
      <header className="max-w-full space-y-3">
        <h1 className="font-display text-display-md text-display">Terms of use</h1>
        <p className="font-sans text-body text-muted">
          Effective {effectiveDate}. These terms apply to your use of {PRODUCT_NAME} (the
          &quot;Service&quot;) offered by 716 Ventures, LLC (&quot;we,&quot; &quot;us,&quot; or
          &quot;our&quot;). By accessing or using the Service, you agree to these terms. If you do
          not agree, do not use the Service.
        </p>
      </header>

      <article className="max-w-full divide-y divide-hairline font-sans text-body text-foreground">
        <section className="space-y-3 pb-10 pt-0" aria-labelledby="terms-eligibility">
          <h2 id="terms-eligibility" className="font-display text-heading text-display">
            Eligibility and accounts
          </h2>
          <p className="m-0 text-muted">
            You must be able to form a binding contract where you live. You are responsible for
            maintaining the confidentiality of your credentials and for activity under your account.
            Notify us promptly if you suspect unauthorized access.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="terms-license">
          <h2 id="terms-license" className="font-display text-heading text-display">
            License to use the Service
          </h2>
          <p className="m-0 text-muted">
            Subject to these terms, we grant you a limited, non-exclusive, non-transferable,
            revocable license to access and use the Service for your personal or internal business
            purposes, in accordance with any documentation we publish and applicable law.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="terms-acceptable">
          <h2 id="terms-acceptable" className="font-display text-heading text-display">
            Acceptable use
          </h2>
          <p className="m-0 text-muted">
            You agree not to misuse the Service. Without limitation, you will not attempt to gain
            unauthorized access; interfere with or disrupt the Service or its infrastructure; use
            the Service to violate others&apos; rights; upload malware; scrape or overload the
            Service in a way that impairs stability; or circumvent security or usage limits. We may
            suspend or terminate access for conduct that we reasonably believe violates these terms
            or creates risk.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="terms-content">
          <h2 id="terms-content" className="font-display text-heading text-display">
            Your content
          </h2>
          <p className="m-0 text-muted">
            You retain rights in data you submit to the Service. You grant us the rights reasonably
            needed to host, process, back up, secure, and operate the Service on your behalf,
            including to improve reliability and prevent abuse. You represent that you have the
            rights needed to provide that data.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="terms-ip">
          <h2 id="terms-ip" className="font-display text-heading text-display">
            Our intellectual property
          </h2>
          <p className="m-0 text-muted">
            The Service, including its software, branding, and documentation, is owned by us or
            our licensors and is protected by intellectual property laws. Except for the limited
            license above, no rights are granted.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="terms-third-party">
          <h2 id="terms-third-party" className="font-display text-heading text-display">
            Third-party services
          </h2>
          <p className="m-0 text-muted">
            The Service may integrate with third-party platforms (for example, listening history
            sources). Your use of third-party services is governed by their terms and policies, not
            ours.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="terms-disclaimers">
          <h2 id="terms-disclaimers" className="font-display text-heading text-display">
            Disclaimers
          </h2>
          <p className="m-0 text-muted">
            The Service is provided &quot;as is&quot; and &quot;as available.&quot; To the fullest
            extent permitted by law, we disclaim all warranties, whether express, implied, or
            statutory, including implied warranties of merchantability, fitness for a particular
            purpose, title, and non-infringement. We do not warrant that the Service will be
            uninterrupted, error-free, or free of harmful components.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="terms-liability">
          <h2 id="terms-liability" className="font-display text-heading text-display">
            Limitation of liability
          </h2>
          <p className="m-0 text-muted">
            To the fullest extent permitted by law, we and our affiliates, directors, employees,
            and suppliers will not be liable for any indirect, incidental, special, consequential,
            exemplary, or punitive damages, or any loss of profits, revenues, goodwill, or data.
            Our aggregate liability for claims arising out of or relating to the Service will not
            exceed the greater of fifty U.S. dollars (USD $50) or the amounts you paid us for the
            Service in the twelve months before the claim (if any).
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="terms-indemnity">
          <h2 id="terms-indemnity" className="font-display text-heading text-display">
            Indemnity
          </h2>
          <p className="m-0 text-muted">
            You will defend and indemnify us against any claims, damages, losses, liabilities, and
            expenses (including reasonable attorneys&apos; fees) arising from your use of the
            Service, your data, or your violation of these terms, to the extent permitted by law.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="terms-termination">
          <h2 id="terms-termination" className="font-display text-heading text-display">
            Termination
          </h2>
          <p className="m-0 text-muted">
            You may stop using the Service at any time. We may suspend or terminate access if we
            reasonably believe you violated these terms, we must comply with law, or we discontinue
            the Service (where we will provide reasonable notice when practicable). Provisions that
            by their nature should survive will survive termination.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="terms-law">
          <h2 id="terms-law" className="font-display text-heading text-display">
            Governing law and disputes
          </h2>
          <p className="m-0 text-muted">
            These terms are governed by the laws of the State of New York, excluding its conflict
            of law rules, except where prohibited by applicable law. Courts in New York may have
            jurisdiction over disputes, unless a mandatory consumer protection law in your place of
            residence requires otherwise.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="terms-changes">
          <h2 id="terms-changes" className="font-display text-heading text-display">
            Changes
          </h2>
          <p className="m-0 text-muted">
            We may update these terms from time to time. We will post the updated terms on this page
            and update the effective date. If changes are material, we will provide additional notice
            as required by law. Continued use after the effective date constitutes acceptance of the
            updated terms.
          </p>
        </section>

        <section className="space-y-3 py-10" aria-labelledby="terms-contact">
          <h2 id="terms-contact" className="font-display text-heading text-display">
            Contact
          </h2>
          <p className="m-0 text-muted">
            Questions about these terms can be directed to the contact information we publish for{" "}
            {PRODUCT_NAME}, or through in-product support channels when available.
          </p>
        </section>

        <p className="m-0 py-10 font-mono text-caption uppercase tracking-[0.06em] text-muted">
          Our plain-language privacy commitments are summarized on{" "}
          <Link href="/covenant" className="text-interactive no-underline hover:underline">
            The 716FM Covenant
          </Link>
          . Detailed practices are described in our{" "}
          <Link href="/privacy" className="text-interactive no-underline hover:underline">
            Privacy policy
          </Link>
          .
        </p>
      </article>
    </LegalDocumentChrome>
  );
}
