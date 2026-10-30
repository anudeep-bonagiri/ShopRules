"use client";

import { useEffect, useState } from "react";
import { Button } from "@shopify/polaris";
import { StatusPill } from "@/components/stitch";

// Connect the Chrome extension without copying the token: this page posts
// {type:"sr-connect", token, baseUrl} to itself, the extension's content script
// (which runs on this origin) relays it to the background worker, which stores
// the token and answers with {type:"sr-connected"}. Manual paste still works.

type State = "idle" | "waiting" | "connected" | "missing";

export function ConnectExtension({ token }: { token: string | null | undefined }) {
  const [state, setState] = useState<State>("idle");
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || !e.data || typeof e.data !== "object") return;
      const data = e.data as { type?: string; ok?: boolean };
      if (data.type === "sr-extension-ready") setDetected(true);
      if (data.type === "sr-connected") setState(data.ok === false ? "missing" : "connected");
    }
    window.addEventListener("message", onMessage);
    // Ask whether the content script is on this page.
    window.postMessage({ type: "sr-ping" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function connect() {
    if (!token) return;
    setState("waiting");
    window.postMessage({ type: "sr-connect", token, baseUrl: window.location.origin }, window.location.origin);
    window.setTimeout(() => setState((s) => (s === "waiting" ? "missing" : s)), 2500);
  }

  return (
    <div className="sr-stack sr-stack--tight">
      <div className="sr-row sr-row--between sr-row--wrap" style={{ gap: 8 }}>
        <Button variant="primary" onClick={connect} disabled={!token || state === "waiting"} loading={state === "waiting"}>
          Connect Chrome extension
        </Button>
        {state === "connected" ? (
          <StatusPill tone="success" dot caps={false}>
            Connected to extension
          </StatusPill>
        ) : detected ? (
          <StatusPill tone="info" dot caps={false}>
            Extension detected
          </StatusPill>
        ) : null}
      </div>
      {state === "missing" ? <p className="sr-xs">No extension answered on this page. Install it from extension/dist, reload this page, and try again, or paste the token into the popup by hand.</p> : null}
      {state === "connected" ? <p className="sr-xs">The extension saved this workspace token. Open any Amazon, Etsy, or Shopify listing and press Alt+Shift+S.</p> : null}
    </div>
  );
}
