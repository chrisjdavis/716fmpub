"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LISTEN_DATA_INVALIDATION_EVENT } from "@/app/dashboard/listen-data-invalidation";
import { formatCount } from "@/app/dashboard/format-count";
import { browserCsrfHeaderRecord } from "@/lib/browser-csrf";
import type { OnboardingStateApiPayload } from "@/types/onboarding-state";
import { OnboardingImportProgressMeter } from "./onboarding-import-progress-meter";

type LoadState = "loading" | "ready" | "error";

/** Padding outside max-width so copy uses the full `max-w-app-content` track (matches `/dashboard` + Export). */
const onboardingShellOuterClass =
  "min-h-0 w-full flex-1 px-6 pb-16 pt-8 md:pb-24 md:pt-12";
const onboardingShellInnerClass = "mx-auto flex min-w-0 w-full max-w-app-content flex-col";

/** Import job rows update independently of listen fingerprint / WS; poll state while onboarding import is active. */
const ONBOARDING_IMPORT_STATE_POLL_MS = 2500 as const;

export function OnboardingClient(
  {
    allowDefer = false,
    embeddedInDashboard = false,
  }: Readonly<{ allowDefer?: boolean; embeddedInDashboard?: boolean }> = {},
) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payload, setPayload] = useState<OnboardingStateApiPayload | null>(null);
  const [welcomeDone, setWelcomeDone] = useState(false);
  const [lastfmUsername, setLastfmUsername] = useState("");
  const [lastfmApiKey, setLastfmApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const router = useRouter();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/onboarding/state", {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Could not load onboarding state (${res.status})`);
    }
    const data = (await res.json()) as OnboardingStateApiPayload;
    setPayload(data);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await refresh();
        if (cancelled) {
          return;
        }
        if (data.state !== "not_started") {
          setWelcomeDone(true);
        }
        setLoadState("ready");
      } catch (e) {
        if (!cancelled) {
          setLoadState("error");
          setLoadError(e instanceof Error ? e.message : "Load failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const postJson = useCallback(
    async (url: string, body: unknown) => {
      const csrf = await browserCsrfHeaderRecord();
      if (!csrf) {
        throw new Error("Security cookie missing — refresh and try again.");
      }
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrf },
        body: JSON.stringify(body),
      });
      return res;
    },
    [],
  );

  const onSaveCredentials = useCallback(async () => {
    setFormError(null);
    setBusy("save");
    try {
      const res = await postJson("/api/onboarding/lastfm/configure", {
        lastfmUsername,
        lastfmApiKey,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(j.error ?? `Save failed (${res.status})`);
        return;
      }
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }, [lastfmApiKey, lastfmUsername, postJson, refresh]);

  const onValidate = useCallback(async () => {
    setFormError(null);
    setBusy("validate");
    try {
      const body: Record<string, string> = {};
      const u = lastfmUsername.trim();
      if (u.length > 0) {
        body.lastfmUsername = u;
      }
      if (lastfmApiKey.length >= 8) {
        body.lastfmApiKey = lastfmApiKey;
      }
      const res = await postJson("/api/onboarding/lastfm/validate", body);
      const j = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok) {
        setFormError(j.message ?? `Validation failed (${res.status})`);
        return;
      }
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setBusy(null);
    }
  }, [lastfmApiKey, lastfmUsername, postJson, refresh]);

  const onStartImport = useCallback(async () => {
    setFormError(null);
    setBusy("import");
    try {
      const res = await postJson("/api/onboarding/import/start", {});
      const j = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok) {
        setFormError(j.message ?? `Could not start import (${res.status})`);
        return;
      }
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Import start failed");
    } finally {
      setBusy(null);
    }
  }, [postJson, refresh]);

  const onDefer = useCallback(async () => {
    setFormError(null);
    setBusy("defer");
    try {
      const res = await postJson("/api/onboarding/defer", {});
      if (!res.ok) {
        setFormError(`Defer failed (${res.status})`);
        return;
      }
      window.location.href = "/dashboard";
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Defer failed");
    } finally {
      setBusy(null);
    }
  }, [postJson]);

  const onComplete = useCallback(async () => {
    setFormError(null);
    setBusy("complete");
    try {
      const res = await postJson("/api/onboarding/complete", {});
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(j.error ?? `Complete failed (${res.status})`);
        return;
      }
      window.location.href = "/dashboard";
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Complete failed");
    } finally {
      setBusy(null);
    }
  }, [postJson]);

  const onboardingImportPhaseActive =
    payload !== null &&
    payload.emailVerified &&
    ["import_started", "import_in_progress", "partial_ready"].includes(payload.state);

  useEffect(() => {
    if (payload?.state === "completed" && payload.emailVerified) {
      router.refresh();
      void refresh().catch(() => {
        /* keep client payload aligned after server auto-completed onboarding */
      });
    }
  }, [payload?.state, payload?.emailVerified, refresh, router]);

  useEffect(() => {
    if (!onboardingImportPhaseActive) {
      return;
    }
    void refresh().catch(() => {
      /* same as invalidation handler */
    });
    const onListenDataInvalidation = () => {
      void refresh().catch(() => {
        /* ignore transient refresh errors; user can retry */
      });
    };
    window.addEventListener(LISTEN_DATA_INVALIDATION_EVENT, onListenDataInvalidation);
    const pollId = setInterval(() => {
      void refresh().catch(() => {
        /* ignore transient refresh errors; user can retry */
      });
    }, ONBOARDING_IMPORT_STATE_POLL_MS);
    return () => {
      window.removeEventListener(LISTEN_DATA_INVALIDATION_EVENT, onListenDataInvalidation);
      clearInterval(pollId);
    };
  }, [onboardingImportPhaseActive, refresh]);

  if (loadState === "loading") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={`${onboardingShellOuterClass} flex flex-1 flex-col`}>
          <div className={`${onboardingShellInnerClass} flex-1 justify-center`}>
            <p className="font-mono text-caption uppercase tracking-[0.08em] text-muted">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  if (loadState === "error" || !payload) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={`${onboardingShellOuterClass} flex flex-1 flex-col`}>
          <div className={`${onboardingShellInnerClass} gap-4`}>
            <p className="text-body text-error">{loadError ?? "Something went wrong."}</p>
            <button
              type="button"
              className="self-start rounded-md border border-wire px-4 py-2 font-mono text-label uppercase tracking-[0.08em]"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!payload.emailVerified) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={`${onboardingShellOuterClass} flex flex-1 flex-col`}>
          <div className={`${onboardingShellInnerClass} max-w-2xl gap-6`}>
            <p className="font-mono text-label uppercase tracking-[0.1em] text-overline">Setup</p>
            <h2 className="font-display text-display-sm text-display">Confirm your email first</h2>
            <p className="text-body text-muted">
              Last.fm setup and imports stay off until your address is verified. Use the email
              banner at the top to resend the confirmation message or open the verify page, complete
              the link in your inbox, then reload this page — the welcome steps will appear here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const showWelcome = !welcomeDone && payload.state === "not_started";
  const showCredentials =
    welcomeDone ||
    payload.state === "configure_lastfm" ||
    payload.state === "validating_lastfm";
  const canValidate =
    payload.hasLastfmUsername &&
    payload.hasLastfmApiKey &&
    (payload.state === "configure_lastfm" || payload.state === "validating_lastfm");
  const showStartImport = payload.state === "ready_to_import";
  const showProgress = ["import_started", "import_in_progress", "partial_ready"].includes(
    payload.state,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={onboardingShellOuterClass}>
        <div className={`${onboardingShellInnerClass} gap-10`}>
      {formError ? (
        <p className="border border-error/40 bg-error/5 px-4 py-3 font-sans text-body text-error">
          {formError}
        </p>
      ) : null}

      {showWelcome ? (
        <section className="space-y-6">
          <p className="font-mono text-label uppercase tracking-[0.1em] text-overline">Welcome</p>
          <h1 className="w-full min-w-0 font-display text-[2.5rem] font-normal leading-[1.05] tracking-tight text-display sm:text-[3rem] md:text-[4.25rem]">
            Welcome to 716FM
          </h1>
          <p className="text-body text-muted">
            We will help you connect your Last.fm listening history and start building your archive.
            This setup only takes a few minutes.
          </p>
          <p className="text-body text-muted">
            You will need a Last.fm username and a personal API key from Last.fm (we walk you through
            it on the next screen).
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              className="border border-wire bg-foreground px-6 py-3 font-mono text-label uppercase tracking-[0.1em] text-canvas"
              onClick={() => setWelcomeDone(true)}
            >
              Get started
            </button>
            {allowDefer ? (
              <button
                type="button"
                className="font-mono text-caption uppercase tracking-[0.08em] text-muted underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => void onDefer()}
                disabled={busy !== null}
              >
                I will do this later
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {showCredentials && !showStartImport && !showProgress ? (
        <section className="space-y-6">
          <p className="font-mono text-label uppercase tracking-[0.1em] text-overline">Last.fm</p>
          <h2 className="font-display text-display-sm text-display">Connect your listening history</h2>
          <p className="text-body text-muted">
            Create a free API application at{" "}
            <a
              href="https://www.last.fm/api/account/create"
              target="_blank"
              rel="noreferrer"
              className="text-interactive underline-offset-2 hover:underline"
            >
              last.fm/api/account/create
            </a>{" "}
            if you do not already have a key. Use application name{" "}
            <span className="font-mono text-caption normal-case">716FM Import</span>.
          </p>
          <label className="block space-y-2">
            <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
              Last.fm username
            </span>
            <input
              className="vs-control w-full"
              value={lastfmUsername}
              onChange={(e) => setLastfmUsername(e.target.value)}
              autoComplete="off"
              maxLength={64}
            />
          </label>
          <label className="block space-y-2">
            <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
              Last.fm API key
            </span>
            <input
              className="vs-control w-full"
              value={lastfmApiKey}
              onChange={(e) => setLastfmApiKey(e.target.value)}
              type="password"
              autoComplete="off"
              maxLength={128}
            />
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              className="border border-wire px-6 py-3 font-mono text-label uppercase tracking-[0.1em] text-foreground"
              onClick={() => void onSaveCredentials()}
              disabled={busy !== null || !lastfmUsername.trim() || lastfmApiKey.length < 8}
            >
              {busy === "save" ? "Saving…" : "Save and continue"}
            </button>
            {canValidate ? (
              <button
                type="button"
                className="border border-wire bg-foreground px-6 py-3 font-mono text-label uppercase tracking-[0.1em] text-canvas"
                onClick={() => void onValidate()}
                disabled={busy !== null}
              >
                {busy === "validate" ? "Checking…" : "Verify connection"}
              </button>
            ) : null}
            {allowDefer ? (
              <button
                type="button"
                className="font-mono text-caption uppercase tracking-[0.08em] text-muted underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => void onDefer()}
                disabled={busy !== null}
              >
                I will do this later
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {showStartImport ? (
        <section className="space-y-6">
          <h2 className="font-display text-display-sm text-display">Start building your archive</h2>
          {payload.importStatus === "failed" ? (
            <div className="space-y-3 border border-error/40 bg-error/5 px-4 py-4">
              <p className="font-mono text-label uppercase tracking-[0.08em] text-error">
                Last import did not finish
              </p>
              {payload.importErrorMessage ? (
                <p className="whitespace-pre-wrap font-sans text-body text-foreground">
                  {payload.importErrorMessage}
                </p>
              ) : (
                <p className="font-sans text-body text-muted">
                  No error details were saved for that run. Confirm your Last.fm API key, keep the
                  background worker running if you use one, then try again.
                </p>
              )}
            </div>
          ) : null}
          <p className="text-body text-muted">
            We will import your Last.fm scrobbles in the background. Keep the worker running locally
            if you are developing (
            <span className="font-mono text-caption normal-case">npm run dev:worker</span>).
          </p>
          <button
            type="button"
            className="border border-wire bg-foreground px-6 py-3 font-mono text-label uppercase tracking-[0.1em] text-canvas"
            onClick={() => void onStartImport()}
            disabled={busy !== null}
          >
            {busy === "import" ? "Starting…" : "Start import"}
          </button>
        </section>
      ) : null}

      {showProgress ? (
        <section className="space-y-12 text-left">
          <header className="space-y-6">
            <p className="font-mono text-label uppercase tracking-[0.1em] text-overline">Setup</p>
            <h1 className="font-display text-display-xl text-display">Building your archive</h1>
            <p className="max-w-2xl font-sans text-body leading-relaxed text-muted">
              Your Last.fm listening history is importing in the background. Batch progress, page
              counts, and stored listens update here as the worker persists data.
            </p>
            <p className="max-w-2xl border border-hairline bg-display/5 px-4 py-3 font-sans text-body leading-relaxed text-muted">
              This can take a while depending on how much history you have. You can close this
              window or sign out; progress is saved. When your import and stats processing finish, we
              email you at your verified address so you know it is safe to come back.
            </p>
          </header>

          <ol className="max-w-2xl space-y-4">
            {payload.importGuidedSteps.map((step) => (
              <li
                key={step.id}
                className="flex gap-4 border-b border-hairline pb-4 last:border-b-0 last:pb-0"
              >
                <span
                  className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-caption tabular-nums ${
                    step.status === "failed"
                      ? "border-error/60 text-error"
                      : "border-wire text-muted"
                  }`}
                  aria-hidden
                >
                  {step.status === "complete"
                    ? "✓"
                    : step.status === "active"
                      ? "…"
                      : step.status === "failed"
                        ? "!"
                        : ""}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="font-mono text-label uppercase tracking-[0.08em] text-foreground">
                    {step.title}
                  </p>
                  <p className="font-sans text-body text-muted">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <OnboardingImportProgressMeter
            itemsProcessed={payload.importItemsProcessed}
            itemsTotal={payload.importItemsTotal}
            importPercent={payload.importPercent}
            listenCount={payload.listenCount}
          />

          <dl className="grid gap-8 border-t border-hairline pt-10 font-mono text-caption uppercase tracking-[0.08em] text-muted sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <dt>Import status</dt>
              <dd className="font-sans text-body normal-case tracking-normal text-foreground">
                {payload.importStatus}
              </dd>
            </div>
            <div className="space-y-2">
              <dt>Listens stored</dt>
              <dd className="font-sans text-body tabular-nums normal-case tracking-normal text-foreground">
                {formatCount(payload.listenCount)}
              </dd>
            </div>
            <div className="space-y-2">
              <dt>Pages persisted</dt>
              <dd className="font-sans text-body tabular-nums normal-case tracking-normal text-foreground">
                {formatCount(payload.importCheckpointPages)}
              </dd>
            </div>
            <div className="space-y-2">
              <dt>Pipeline</dt>
              <dd className="font-sans text-body normal-case tracking-normal text-foreground">
                {payload.importPipelineSummary ?? "—"}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {!embeddedInDashboard ? (
              <Link
                href="/dashboard"
                className="inline-flex min-w-[160px] items-center justify-center rounded-md border border-wire px-4 py-3 font-mono text-caption uppercase tracking-[0.28em] text-foreground no-underline transition-colors hover:border-foreground hover:bg-display hover:text-canvas md:min-w-[180px]"
              >
                Go to dashboard
              </Link>
            ) : null}
            {(payload.importStatsProcessingComplete ||
              (payload.hasUsableArchiveData &&
                ["import_started", "import_in_progress", "partial_ready"].includes(
                  payload.state,
                ))) && (
              <button
                type="button"
                className="inline-flex min-w-[160px] items-center justify-center rounded-md border border-wire bg-foreground px-4 py-3 font-mono text-caption uppercase tracking-[0.28em] text-canvas transition-colors hover:opacity-95 md:min-w-[180px]"
                onClick={() => void onComplete()}
                disabled={busy !== null}
              >
                {busy === "complete" ? "Finishing…" : "Finish setup"}
              </button>
            )}
          </div>
        </section>
      ) : null}
        </div>
      </div>
    </div>
  );
}
