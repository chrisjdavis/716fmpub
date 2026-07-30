"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useState, type KeyboardEvent } from "react";
import { SettingsAccountDelete } from "./settings-account-delete";
import { SettingsEmailChange } from "./settings-email-change";
import { SettingsListenDataReset } from "./settings-listen-data-reset";
import {
  SettingsAccountProfileForm,
  SettingsDataSourcesProfileForm,
  SettingsListeningHistoryPublicForm,
  SettingsProfileMessages,
  SettingsProfileProvider,
  type SettingsProfileInitial,
} from "./settings-profile-forms";

const sectionKicker = "mb-3 font-mono text-label uppercase tracking-[0.1em] text-overline";

type Tab = "account" | "sources" | "export" | "deletion";

function hashToTab(hash: string): Tab {
  if (hash === "#settings-sources") {
    return "sources";
  }
  if (hash === "#settings-export") {
    return "export";
  }
  if (hash === "#settings-deletion") {
    return "deletion";
  }
  return "account";
}

function tabToHash(t: Tab): string {
  if (t === "sources") {
    return "#settings-sources";
  }
  if (t === "export") {
    return "#settings-export";
  }
  if (t === "deletion") {
    return "#settings-deletion";
  }
  return "#settings-account";
}

export function SettingsTabsLayout({
  profileInitial,
  currentEmail,
  emailVerified,
  listenDataConfirmPhrase,
  accountDeleteConfirmPhrase,
}: Readonly<{
  profileInitial: SettingsProfileInitial;
  currentEmail: string;
  emailVerified: boolean;
  listenDataConfirmPhrase: string;
  accountDeleteConfirmPhrase: string;
}>) {
  const [tab, setTab] = useState<Tab>("account");

  useLayoutEffect(() => {
    setTab(hashToTab(window.location.hash));
  }, []);

  useEffect(() => {
    const onHash = () => setTab(hashToTab(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const selectTab = useCallback((t: Tab) => {
    setTab(t);
    const next = `${window.location.pathname}${window.location.search}${tabToHash(t)}`;
    window.history.replaceState(null, "", next);
  }, []);

  const onTabArrowKey = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const order: Tab[] = ["account", "sources", "export", "deletion"];
      const idx = order.indexOf(tab);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        selectTab(order[(idx + 1) % order.length]!);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        selectTab(order[(idx - 1 + order.length) % order.length]!);
      }
    },
    [selectTab, tab],
  );

  const tabClass = (active: boolean) =>
    `min-h-11 flex-1 px-4 py-3 text-center font-mono text-caption uppercase tracking-[0.08em] transition-colors sm:flex-none sm:px-8 ${
      active
        ? "border-b-2 border-foreground bg-raised/30 text-foreground"
        : "text-muted hover:bg-raised/20 hover:text-foreground"
    }`;

  return (
    <SettingsProfileProvider initial={profileInitial}>
      <div className="overflow-hidden rounded-md border border-hairline bg-surface">
        <div
          className="flex flex-wrap gap-0 border-b border-hairline"
          role="tablist"
          aria-label="Settings sections"
        >
          <button
            type="button"
            role="tab"
            id="settings-tab-account"
            aria-selected={tab === "account"}
            aria-controls="settings-panel-account"
            tabIndex={tab === "account" ? 0 : -1}
            className={tabClass(tab === "account")}
            onClick={() => selectTab("account")}
            onKeyDown={onTabArrowKey}
          >
            Account
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-sources"
            aria-selected={tab === "sources"}
            aria-controls="settings-panel-sources"
            tabIndex={tab === "sources" ? 0 : -1}
            className={tabClass(tab === "sources")}
            onClick={() => selectTab("sources")}
            onKeyDown={onTabArrowKey}
          >
            Data sources
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-export"
            aria-selected={tab === "export"}
            aria-controls="settings-panel-export"
            tabIndex={tab === "export" ? 0 : -1}
            className={tabClass(tab === "export")}
            onClick={() => selectTab("export")}
            onKeyDown={onTabArrowKey}
          >
            Export
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-deletion"
            aria-selected={tab === "deletion"}
            aria-controls="settings-panel-deletion"
            tabIndex={tab === "deletion" ? 0 : -1}
            className={tabClass(tab === "deletion")}
            onClick={() => selectTab("deletion")}
            onKeyDown={onTabArrowKey}
          >
            Deletion
          </button>
        </div>

        <SettingsProfileMessages />

        <div
          id="settings-panel-account"
          role="tabpanel"
          aria-labelledby="settings-tab-account"
          hidden={tab !== "account"}
          className="space-y-8 p-6 md:p-8"
        >
          <h2 id="settings-account" className={sectionKicker}>
            Account
          </h2>
          <p className="font-sans text-body text-foreground">
            Sign-in email and verification, plus your display name. Last.fm username, optional API
            key, and stats time zone live on the{" "}
            <button
              type="button"
              className="text-interactive underline decoration-hairline underline-offset-2 hover:underline"
              onClick={() => selectTab("sources")}
            >
              Data sources
            </button>{" "}
            tab.
          </p>
          <div>
            <SettingsEmailChange currentEmail={currentEmail} emailVerified={emailVerified} />
          </div>
          <SettingsAccountProfileForm />
          <SettingsListeningHistoryPublicForm />
        </div>

        <div
          id="settings-panel-sources"
          role="tabpanel"
          aria-labelledby="settings-tab-sources"
          hidden={tab !== "sources"}
          className="space-y-8 p-6 md:p-8"
        >
          <h2 id="settings-sources" className={sectionKicker}>
            Data sources
          </h2>
          <p className="font-sans text-body text-foreground">
            Each account can store a Last.fm API key (recommended for multi-tenant hosting) or rely on
            a shared <span className="font-mono text-caption normal-case">LASTFM_API_KEY</span> on the
            worker. Imports still need{" "}
            <span className="font-mono text-caption normal-case tracking-normal">npm run dev:worker</span>{" "}
            (or your deployed worker) running out of band. Your display name is edited on the{" "}
            <button
              type="button"
              className="text-interactive underline decoration-hairline underline-offset-2 hover:underline"
              onClick={() => selectTab("account")}
            >
              Account
            </button>{" "}
            tab. Clear a text field here and save to remove it. The API key is never shown again
            after save; use replace or remove below.
          </p>
          <SettingsDataSourcesProfileForm />
        </div>

        <div
          id="settings-panel-export"
          role="tabpanel"
          aria-labelledby="settings-tab-export"
          hidden={tab !== "export"}
          className="space-y-6 p-6 md:p-8"
        >
          <h2 id="settings-export" className={sectionKicker}>
            Export
          </h2>
          <p className="font-sans text-body text-muted">
            JSON, CSV, and filtered exports of your listening history.
          </p>
          <Link
            href="/dashboard/export"
            className="inline-flex border border-wire px-6 py-3 font-mono text-label uppercase tracking-[0.1em] text-foreground no-underline hover:no-underline hover:bg-raised"
          >
            Take everything with you
          </Link>
        </div>

        <div
          id="settings-panel-deletion"
          role="tabpanel"
          aria-labelledby="settings-tab-deletion"
          hidden={tab !== "deletion"}
          className="space-y-6 p-6 md:p-8"
        >
          <h2 id="settings-deletion" className={sectionKicker}>
            Deletion
          </h2>
          <p className="font-sans text-body text-muted">
            Permanent removal of listen and import data. Account login is not removed by the reset
            below.
          </p>
          <SettingsListenDataReset confirmPhrase={listenDataConfirmPhrase} />
          <SettingsAccountDelete confirmPhrase={accountDeleteConfirmPhrase} />
        </div>
      </div>
    </SettingsProfileProvider>
  );
}
