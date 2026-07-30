"use client";

import { sanitizeUserFacingPlainText } from "@vs/domain/user-facing-plain-text";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { browserCsrfHeaderRecord } from "@/lib/browser-csrf";
import { commonStatsTimeZonesGrouped } from "@/lib/common-iana-time-zones";

export type SettingsProfileInitial = Readonly<{
  displayName: string;
  lastfmUsername: string;
  hasLastfmApiKey: boolean;
  statsTimezone: string | null;
  listeningHistoryPublic: boolean;
}>;

type FieldErrors = {
  displayName?: string;
  lastfmUsername?: string;
  lastfmApiKey?: string;
  statsTimezone?: string;
};

type ProfileContextValue = Readonly<{
  displayName: string;
  setDisplayName: (v: string) => void;
  lastfmUsername: string;
  setLastfmUsername: (v: string) => void;
  hasLastfmApiKey: boolean;
  lastfmApiKeyInput: string;
  setLastfmApiKeyInput: (v: string) => void;
  removeLastfmApiKey: boolean;
  setRemoveLastfmApiKey: (v: boolean) => void;
  statsTimezone: string;
  setStatsTimezone: (v: string) => void;
  listeningHistoryPublic: boolean;
  setListeningHistoryPublic: (v: boolean) => void;
  fieldErrors: FieldErrors | null;
  formError: string | null;
  status: string | null;
  pending: boolean;
  submit: () => Promise<void>;
  submitListeningHistoryPublic: (next: boolean) => Promise<void>;
}>;

const ProfileContext = createContext<ProfileContextValue | null>(null);

function useSettingsProfile(): ProfileContextValue {
  const v = useContext(ProfileContext);
  if (v === null) {
    throw new Error("useSettingsProfile must be used within SettingsProfileProvider");
  }
  return v;
}

export function SettingsProfileProvider({
  initial,
  children,
}: Readonly<{ initial: SettingsProfileInitial; children: ReactNode }>) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [lastfmUsername, setLastfmUsername] = useState(initial.lastfmUsername);
  const [hasLastfmApiKey, setHasLastfmApiKey] = useState(initial.hasLastfmApiKey);
  const [lastfmApiKeyInput, setLastfmApiKeyInput] = useState("");
  const [removeLastfmApiKey, setRemoveLastfmApiKey] = useState(false);
  const [statsTimezone, setStatsTimezone] = useState(
    initial.statsTimezone === null ? "" : initial.statsTimezone,
  );
  const [listeningHistoryPublic, setListeningHistoryPublic] = useState(
    initial.listeningHistoryPublic,
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setDisplayName(initial.displayName);
    setLastfmUsername(initial.lastfmUsername);
    setHasLastfmApiKey(initial.hasLastfmApiKey);
    setStatsTimezone(initial.statsTimezone === null ? "" : initial.statsTimezone);
    setListeningHistoryPublic(initial.listeningHistoryPublic);
  }, [
    initial.displayName,
    initial.lastfmUsername,
    initial.hasLastfmApiKey,
    initial.statsTimezone,
    initial.listeningHistoryPublic,
  ]);

  const submit = useCallback(async () => {
    setFieldErrors(null);
    setFormError(null);
    setStatus(null);
    setPending(true);
    const body: Record<string, unknown> = {
      displayName,
      lastfmUsername,
      statsTimezone: statsTimezone.trim() === "" ? null : statsTimezone.trim(),
      listeningHistoryPublic,
    };
    if (removeLastfmApiKey) {
      body.lastfmApiKey = null;
    } else if (lastfmApiKeyInput.trim() !== "") {
      body.lastfmApiKey = lastfmApiKeyInput.trim();
    }

    const csrf = await browserCsrfHeaderRecord();
    if (!csrf) {
      setPending(false);
      setFormError("Could not prepare a secure request. Refresh the page and try again.");
      return;
    }

    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...csrf },
      credentials: "include",
      body: JSON.stringify(body),
    });
    setPending(false);
    if (!res.ok) {
      let message = `[ERROR: HTTP ${res.status}]`;
      try {
        const resBody: unknown = await res.json();
        if (resBody && typeof resBody === "object") {
          const rec = resBody as Record<string, unknown>;
          if (typeof rec.error === "string") {
            message = rec.error;
          }
          if (rec.details && typeof rec.details === "object") {
            const d = rec.details as {
              fieldErrors?: Record<string, string[] | undefined>;
              formErrors?: string[];
            };
            const fe: FieldErrors = {};
            const dn = d.fieldErrors?.displayName?.[0];
            const lf = d.fieldErrors?.lastfmUsername?.[0];
            const lk = d.fieldErrors?.lastfmApiKey?.[0];
            const st = d.fieldErrors?.statsTimezone?.[0];
            if (typeof dn === "string") {
              fe.displayName = dn;
            }
            if (typeof lf === "string") {
              fe.lastfmUsername = lf;
            }
            if (typeof lk === "string") {
              fe.lastfmApiKey = lk;
            }
            if (typeof st === "string") {
              fe.statsTimezone = st;
            }
            if (Object.keys(fe).length > 0) {
              setFieldErrors(fe);
            }
            const form0 = d.formErrors?.[0];
            if (
              typeof form0 === "string" &&
              !fe.displayName &&
              !fe.lastfmUsername &&
              !fe.lastfmApiKey &&
              !fe.statsTimezone
            ) {
              message = form0;
            }
          }
        }
      } catch {
        /* ignore */
      }
      setFormError(sanitizeUserFacingPlainText(message));
      return;
    }
    setStatus("[SAVED]");
    setLastfmApiKeyInput("");
    setRemoveLastfmApiKey(false);
    try {
      const resBody: unknown = await res.json();
      if (
        resBody &&
        typeof resBody === "object" &&
        "user" in resBody &&
        resBody.user &&
        typeof resBody.user === "object"
      ) {
        const u = resBody.user as Record<string, unknown>;
        if (typeof u.displayName === "string") {
          setDisplayName(u.displayName);
        } else if (u.displayName === null) {
          setDisplayName("");
        }
        if (typeof u.lastfmUsername === "string") {
          setLastfmUsername(u.lastfmUsername);
        } else if (u.lastfmUsername === null) {
          setLastfmUsername("");
        }
        if (typeof u.hasLastfmApiKey === "boolean") {
          setHasLastfmApiKey(u.hasLastfmApiKey);
        }
        if (typeof u.statsTimezone === "string") {
          setStatsTimezone(u.statsTimezone);
        } else if (u.statsTimezone === null) {
          setStatsTimezone("");
        }
        if (typeof u.listeningHistoryPublic === "boolean") {
          setListeningHistoryPublic(u.listeningHistoryPublic);
        }
      }
    } catch {
      /* ignore */
    }
  }, [
    displayName,
    lastfmUsername,
    lastfmApiKeyInput,
    removeLastfmApiKey,
    statsTimezone,
    listeningHistoryPublic,
  ]);

  const submitListeningHistoryPublic = useCallback(
    async (next: boolean) => {
      setFieldErrors(null);
      setFormError(null);
      setStatus(null);
      setPending(true);
      const csrf = await browserCsrfHeaderRecord();
      if (!csrf) {
        setPending(false);
        setFormError("Could not prepare a secure request. Refresh the page and try again.");
        return;
      }
      const previous = listeningHistoryPublic;
      setListeningHistoryPublic(next);
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...csrf },
        credentials: "include",
        body: JSON.stringify({
          displayName,
          lastfmUsername,
          listeningHistoryPublic: next,
        }),
      });
      setPending(false);
      if (!res.ok) {
        setListeningHistoryPublic(previous);
        let message = `[ERROR: HTTP ${res.status}]`;
        try {
          const resBody: unknown = await res.json();
          if (
            resBody &&
            typeof resBody === "object" &&
            typeof (resBody as { error?: unknown }).error === "string"
          ) {
            message = (resBody as { error: string }).error;
          }
        } catch {
          /* ignore */
        }
        setFormError(sanitizeUserFacingPlainText(message));
        return;
      }
      setStatus(
        next ? "Explore and Archive are now public." : "Explore and Archive are private again.",
      );
    },
    [displayName, lastfmUsername, listeningHistoryPublic],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({
      displayName,
      setDisplayName,
      lastfmUsername,
      setLastfmUsername,
      hasLastfmApiKey,
      lastfmApiKeyInput,
      setLastfmApiKeyInput,
      removeLastfmApiKey,
      setRemoveLastfmApiKey,
      statsTimezone,
      setStatsTimezone,
      listeningHistoryPublic,
      setListeningHistoryPublic,
      fieldErrors,
      formError,
      status,
      pending,
      submit,
      submitListeningHistoryPublic,
    }),
    [
      displayName,
      lastfmUsername,
      hasLastfmApiKey,
      lastfmApiKeyInput,
      removeLastfmApiKey,
      statsTimezone,
      listeningHistoryPublic,
      fieldErrors,
      formError,
      status,
      pending,
      submit,
      submitListeningHistoryPublic,
    ],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function SettingsProfileMessages() {
  const { formError, status } = useSettingsProfile();
  if (!formError && !status) {
    return null;
  }
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="space-y-2 border-b border-hairline px-6 py-3 md:px-8"
    >
      {formError ? (
        <p className="font-mono text-caption uppercase tracking-[0.04em] text-error">{formError}</p>
      ) : null}
      {status ? (
        <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">{status}</p>
      ) : null}
    </div>
  );
}

export function SettingsAccountProfileForm() {
  const { displayName, setDisplayName, fieldErrors, submit, pending } = useSettingsProfile();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submit();
  }

  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      <label className="block space-y-2">
        <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
          Display name
        </span>
        <input
          name="displayName"
          type="text"
          autoComplete="name"
          value={displayName}
          onChange={(ev) => setDisplayName(ev.target.value)}
          maxLength={120}
          className="vs-control"
        />
        {fieldErrors?.displayName ? (
          <span className="font-mono text-caption uppercase tracking-[0.04em] text-error">
            {sanitizeUserFacingPlainText(fieldErrors.displayName)}
          </span>
        ) : (
          <span className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
            Optional. Shown where the product needs a human-readable label.
          </span>
        )}
      </label>
      <button
        type="submit"
        disabled={pending}
        className="border border-wire bg-transparent px-8 py-3 font-mono text-label uppercase tracking-[0.1em] text-foreground transition-opacity hover:bg-raised disabled:opacity-40"
      >
        {pending ? "[SAVING…]" : "Save display name"}
      </button>
    </form>
  );
}

export function SettingsListeningHistoryPublicForm() {
  const {
    listeningHistoryPublic,
    submitListeningHistoryPublic,
    pending,
  } = useSettingsProfile();

  return (
    <div className="space-y-4 border-t border-hairline pt-8">
      <h3 className="font-mono text-label uppercase tracking-[0.1em] text-overline">
        Public listening history
      </h3>
      <p className="font-sans text-body text-muted">
        When enabled, anyone with the URL can open Explore and Archive on this instance — including
        play counts, timelines, and listen rows. Home, imports, exports, and settings stay private.
        Default is off.
      </p>
      <label className="flex cursor-pointer items-start gap-3 font-sans text-body text-foreground">
        <input
          type="checkbox"
          className="mt-1 border border-hairline"
          checked={listeningHistoryPublic}
          disabled={pending}
          onChange={(ev) => {
            void submitListeningHistoryPublic(ev.target.checked);
          }}
        />
        <span>
          Make Explore and Archive public at{" "}
          <span className="font-mono text-caption normal-case tracking-normal">/explore</span> and{" "}
          <span className="font-mono text-caption normal-case tracking-normal">/archive</span>
        </span>
      </label>
      {listeningHistoryPublic ? (
        <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
          Public links: /explore · /archive
        </p>
      ) : null}
    </div>
  );
}

export function SettingsDataSourcesProfileForm() {
  const {
    lastfmUsername,
    setLastfmUsername,
    hasLastfmApiKey,
    lastfmApiKeyInput,
    setLastfmApiKeyInput,
    removeLastfmApiKey,
    setRemoveLastfmApiKey,
    statsTimezone,
    setStatsTimezone,
    fieldErrors,
    submit,
    pending,
  } = useSettingsProfile();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submit();
  }

  return (
    <form className="w-full max-w-none space-y-10" onSubmit={onSubmit}>
      <div className="space-y-8">
        <label className="block space-y-2">
          <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
            Last.fm username
          </span>
          <input
            name="lastfmUsername"
            type="text"
            autoComplete="username"
            value={lastfmUsername}
            onChange={(ev) => setLastfmUsername(ev.target.value)}
            maxLength={64}
            className="vs-control"
          />
          {fieldErrors?.lastfmUsername ? (
            <span className="font-mono text-caption uppercase tracking-[0.04em] text-error">
              {sanitizeUserFacingPlainText(fieldErrors.lastfmUsername)}
            </span>
          ) : (
            <span className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
              Stored trimmed. When set, 1–64 characters—the same rule as the Last.fm username on
              import jobs. Clear the field and save to unset.
            </span>
          )}
        </label>
        <div className="block space-y-3">
          <label className="block space-y-2">
            <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
              Last.fm API key
            </span>
            <input
              name="lastfmApiKey"
              type="password"
              autoComplete="off"
              value={lastfmApiKeyInput}
              onChange={(ev) => setLastfmApiKeyInput(ev.target.value)}
              maxLength={128}
              placeholder={hasLastfmApiKey ? "Enter a new key to replace the saved one" : ""}
              className="vs-control"
            />
            {fieldErrors?.lastfmApiKey ? (
              <span className="font-mono text-caption uppercase tracking-[0.04em] text-error">
                {sanitizeUserFacingPlainText(fieldErrors.lastfmApiKey)}
              </span>
            ) : (
              <span className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
                Optional per-account key from{" "}
                <a
                  href="https://www.last.fm/api/account/create"
                  className="text-foreground underline decoration-hairline underline-offset-2"
                  target="_blank"
                  rel="noreferrer"
                >
                  Last.fm API account
                </a>
                . When set, imports use it instead of the worker&apos;s{" "}
                <span className="font-mono normal-case tracking-normal">LASTFM_API_KEY</span>. Leave
                blank to keep an existing key; the server never returns the secret after save.
              </span>
            )}
          </label>
          {hasLastfmApiKey ? (
            <label className="flex cursor-pointer items-start gap-3 font-sans text-body text-foreground">
              <input
                type="checkbox"
                className="mt-1 border border-hairline"
                checked={removeLastfmApiKey}
                onChange={(ev) => setRemoveLastfmApiKey(ev.target.checked)}
              />
              <span>
                Remove saved Last.fm API key on save (checked wins over a new key typed above).
              </span>
            </label>
          ) : null}
        </div>
        <label className="block space-y-2">
          <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
            Stats time zone
          </span>
          <select
            name="statsTimezone"
            value={statsTimezone}
            onChange={(ev) => setStatsTimezone(ev.target.value)}
            className="vs-control"
          >
            <option value="">Auto (edge header when present, otherwise UTC)</option>
            {commonStatsTimeZonesGrouped().map(({ label, zones }) => (
              <optgroup key={label} label={label}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {fieldErrors?.statsTimezone ? (
            <span className="font-mono text-caption uppercase tracking-[0.04em] text-error">
              {sanitizeUserFacingPlainText(fieldErrors.statsTimezone)}
            </span>
          ) : (
            <span className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
              Drives calendar labels on your home briefing and day buckets; rolling totals still use
              the same listen timestamps.
            </span>
          )}
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="border border-wire bg-transparent px-8 py-3 font-mono text-label uppercase tracking-[0.1em] text-foreground transition-opacity hover:bg-raised disabled:opacity-40"
      >
        {pending ? "[SAVING…]" : "Save data sources"}
      </button>
    </form>
  );
}
