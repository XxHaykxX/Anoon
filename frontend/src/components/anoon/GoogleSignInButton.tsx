"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Google Identity Services, rendered as Google's own button in the login
 * screen's provider row.
 *
 * Google's script draws the button, inside its own iframe, and that is not a
 * styling preference: the ID token is only handed to a callback GIS registers,
 * and Google requires their button for that flow.
 *
 * It is shown at its natural size rather than stretched. The first version laid
 * an invisible, 3x-scaled copy over our own glyph so the row would read as three
 * identical buttons — but a transform only stretches the hit area on paper: the
 * iframe stays 40px, the container clips whatever overflows, and a tap landing
 * outside the intersection does nothing at all. Reported as "often does not
 * react", which is exactly what a partly-live target feels like. A circular
 * Google button next to two circular placeholders keeps the row honest and every
 * pixel of it clickable.
 *
 * Env: NEXT_PUBLIC_GOOGLE_CLIENT_ID. Unset → this component renders nothing and
 * the caller keeps showing its disabled placeholder; a build with no client id
 * must not offer a button that can only fail.
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const GSI_SRC = "https://accounts.google.com/gsi/client";

/** Configured at build time? Callers use this to decide what to render. */
export const GOOGLE_ENABLED = CLIENT_ID.length > 0;

interface GsiCredentialResponse {
  credential?: string;
}

interface GsiId {
  initialize(config: {
    client_id: string;
    callback: (r: GsiCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } };
  }
}

/** Load the GIS script once per document, resolving when it is usable. */
function loadGsi(): Promise<GsiId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  return new Promise((resolve, reject) => {
    // A second mount must not add a second <script>: GIS re-initializing under
    // itself drops the first callback and the button stops answering.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const el = existing ?? document.createElement("script");
    const onLoad = () => {
      const id = window.google?.accounts?.id;
      if (id) resolve(id);
      else reject(new Error("GIS загрузился, но google.accounts.id отсутствует"));
    };
    el.addEventListener("load", onLoad, { once: true });
    el.addEventListener("error", () => reject(new Error("Не удалось загрузить Google")), {
      once: true,
    });
    if (!existing) {
      el.src = GSI_SRC;
      el.async = true;
      el.defer = true;
      document.head.appendChild(el);
    }
  });
}

export default function GoogleSignInButton({
  onCredential,
  disabled,
}: {
  /** Called with the Google ID token once the person has signed in. */
  onCredential: (idToken: string) => void;
  disabled?: boolean;
}) {
  const slot = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  // The callback is read through a ref so re-renders (submitting, errors) never
  // re-initialize GIS — initialize() is global and the last call wins.
  const latest = useRef(onCredential);
  useEffect(() => {
    latest.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    if (!GOOGLE_ENABLED) return;
    let cancelled = false;

    void loadGsi()
      .then((id) => {
        if (cancelled || !slot.current) return;
        id.initialize({
          client_id: CLIENT_ID,
          callback: (r) => {
            if (r.credential) latest.current(r.credential);
          },
          // No One Tap on load: this screen is an explicit sign-in, and an
          // auto-selected account would log somebody in without them asking.
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        id.renderButton(slot.current, {
          type: "icon",
          shape: "circle",
          theme: "filled_black",
          size: "large",
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!GOOGLE_ENABLED) return null;

  return (
    <div
      className={`grid size-12 place-items-center ${
        disabled || failed ? "pointer-events-none opacity-50" : ""
      }`}
    >
      {/* Google's own button, at its own size. Nothing is laid over it. */}
      <div ref={slot} aria-label="Войти через Google" />
    </div>
  );
}
