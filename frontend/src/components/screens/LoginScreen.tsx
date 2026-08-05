"use client";

import { useState } from "react";
import { GlobeIcon, ChevronRightIcon } from "@/components/icons";

// --- Tiny inline SVGs not present in the shared icon set ---

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.6 18.6 0 0 1 4.22-5.06M9.9 4.24A10.4 10.4 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3.02c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.12A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54V6.61H1.26a12 12 0 0 0 0 10.78l4.01-3.12z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.61l4.01 3.12C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </svg>
  );
}

function AppleMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M16.36 1.43c0 1.14-.42 2.2-1.24 3.03-.86.87-2.02 1.5-3.13 1.41-.12-1.09.44-2.24 1.22-3.02.85-.88 2.28-1.53 3.15-1.42zM20.9 17.44c-.5 1.16-.75 1.67-1.4 2.7-.9 1.42-2.18 3.2-3.75 3.22-1.4.02-1.76-.9-3.65-.89-1.9.01-2.3.9-3.7.88-1.58-.02-2.78-1.6-3.68-3.02-2.52-3.96-2.78-8.6-1.23-11.07 1.1-1.75 2.83-2.77 4.46-2.77 1.66 0 2.7.9 4.08.9 1.33 0 2.15-.9 4.08-.9 1.45 0 2.98.79 4.07 2.15-3.58 1.96-3 7.06 1.72 8.8z" />
    </svg>
  );
}

function FacebookMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path
        fill="#fff"
        d="M15.5 12.5H13.7V20h-3.1v-7.5H9.4V10h1.2V8.6c0-1.9 1-3 3.3-3h2v2.6h-1.3c-.9 0-1 .35-1 1V10h2.3l-.2 2.5z"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth={3}
        opacity={0.25}
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lang, setLang] = useState("EN");
  const [langOpen, setLangOpen] = useState(false);

  const canSubmit = identifier.trim().length > 0 && password.length > 0;

  function handleLogin() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
    }, 1000);
  }

  return (
    <div className="w-full bg-background text-foreground flex flex-col h-full relative overflow-hidden">
      {/* Soft brand glow */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[420px] h-[420px] rounded-full blur-3xl"
        style={{ background: "rgba(253,191,45,0.14)" }}
      />

      {/* Language selector, top-right */}
      <div className="relative z-20 flex justify-end px-5 pt-5">
        <div className="relative">
          <button
            type="button"
            onClick={() => setLangOpen((v) => !v)}
            className="flex items-center gap-1.5 text-muted-foreground text-sm active:scale-95 transition-transform cursor-pointer"
          >
            <GlobeIcon className="size-4" />
            <span>{lang}</span>
          </button>
          {langOpen && (
            <div className="absolute right-0 mt-2 w-28 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
              {["EN", "RU", "ES"].map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    setLang(code);
                    setLangOpen(false);
                  }}
                  className={
                    "flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-muted " +
                    (code === lang ? "text-primary font-medium" : "text-foreground")
                  }
                >
                  {code === "EN" ? "English" : code === "RU" ? "Русский" : "Español"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="relative z-10 flex-1 flex flex-col px-6 pt-6">
        {/* Logo */}
        <div className="flex flex-col items-center text-center">
          <div className="size-16 rounded-2xl bg-primary grid place-items-center shadow-sm">
            <span className="text-primary-foreground text-3xl font-bold">
              B
            </span>
          </div>
          <h1 className="mt-5 text-2xl font-bold">Welcome to Anoon</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Sign in to continue
          </p>
        </div>

        {/* Form */}
        <div className="mt-8 flex flex-col gap-3">
          <input
            type="text"
            placeholder="Email or phone"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="rounded-xl bg-muted px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none"
          />

          <div className="rounded-xl bg-muted px-4 py-3 flex items-center gap-2">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex-1 min-w-0 bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((prev) => !prev)}
              className="shrink-0 text-muted-foreground active:scale-95 transition-transform cursor-pointer"
            >
              {showPassword ? (
                <EyeOffIcon className="size-5" />
              ) : (
                <EyeIcon className="size-5" />
              )}
            </button>
          </div>

          <div className="flex justify-end">
            <button className="text-primary text-sm font-medium active:scale-95 transition-transform cursor-pointer">
              Forgot password?
            </button>
          </div>

          <button
            type="button"
            disabled={!canSubmit || submitting}
            onClick={handleLogin}
            className={`mt-1 w-full rounded-xl bg-primary text-primary-foreground py-3.5 font-semibold active:scale-95 transition-transform cursor-pointer flex items-center justify-center gap-2 ${
              !canSubmit || submitting ? "opacity-50 cursor-not-allowed" : ""
            }`}
            style={{ boxShadow: "0 8px 24px -6px rgba(253,191,45,0.4)" }}
          >
            {submitting ? (
              <>
                <SpinnerIcon className="animate-spin" />
                Signing in…
              </>
            ) : (
              "Log in"
            )}
          </button>
        </div>

        {/* Divider */}
        <div className="mt-7 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">
            or continue with
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Social buttons */}
        <div className="mt-4 flex items-center gap-3">
          <button className="flex-1 rounded-xl border border-border py-3 grid place-items-center active:scale-95 transition-transform cursor-pointer">
            <GoogleMark />
          </button>
          <button className="flex-1 rounded-xl border border-border py-3 grid place-items-center active:scale-95 transition-transform cursor-pointer">
            <AppleMark />
          </button>
          <button className="flex-1 rounded-xl border border-border py-3 grid place-items-center active:scale-95 transition-transform cursor-pointer">
            <FacebookMark />
          </button>
        </div>
      </div>

      {/* Bottom sign-up link */}
      <div className="relative z-10 mt-auto pb-6 flex items-center justify-center gap-1.5 text-sm">
        <span className="text-muted-foreground">Don&apos;t have an account?</span>
        <button className="text-primary font-medium flex items-center gap-0.5 active:scale-95 transition-transform cursor-pointer">
          Create one
          <ChevronRightIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
