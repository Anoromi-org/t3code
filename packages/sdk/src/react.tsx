import { useId, useState, useSyncExternalStore } from "react";
import type { Connection } from "./connection.ts";

export function useT3Connection(connection: Connection) {
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);
}

/** Import @anoromi/t3code-sdk/style.css once. The caller owns the connection lifetime. */
export function T3Connect({
  connection,
  className,
}: {
  readonly connection: Connection;
  readonly className?: string;
}) {
  const state = useT3Connection(connection);
  const inputId = useId();
  const [pairingUrl, setPairingUrl] = useState("");
  if (state.status === "connected") {
    return (
      <div className={`t3-connect ${className ?? ""}`}>
        <div className="t3-connect-body">
          <h2>Connected to T3 Code</h2>
          <p role="status">Connected to {new URL(state.url).host}</p>
        </div>
        <div className="t3-connect-actions">
          <button
            type="button"
            onClick={() => {
              void connection.disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }
  const pending = state.status === "connecting";
  return (
    <form
      className={`t3-connect ${className ?? ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || !pairingUrl.trim()) return;
        const url = pairingUrl.trim();
        setPairingUrl("");
        void connection.pair(url);
      }}
    >
      <div className="t3-connect-body">
        <header>
          <h2>Connect to T3 Code</h2>
          <p>Connect this app to your T3 Code environment.</p>
        </header>
        <label htmlFor={inputId}>T3 Code pairing link</label>
        <input
          id={inputId}
          type="password"
          placeholder="Paste pairing link…"
          aria-describedby={`${inputId}-help`}
          autoComplete="off"
          spellCheck={false}
          value={pairingUrl}
          disabled={pending}
          required
          onChange={(event) => setPairingUrl(event.target.value)}
        />
        <p id={`${inputId}-help`} className="t3-connect-help">
          Paste a pairing link from your T3 Code environment.
        </p>
        {state.status === "error" && (
          <p role="alert">
            {state.canReconnect
              ? "Could not connect. Retry the saved connection or use a new pairing link."
              : "Could not connect. Check the pairing link and try again."}
          </p>
        )}
        {pending && <p role="status">Connecting…</p>}
      </div>
      <div className="t3-connect-actions">
        {state.status === "error" && state.canReconnect && (
          <button
            type="button"
            onClick={() => {
              void connection.reconnect();
            }}
          >
            Reconnect
          </button>
        )}
        {pending && (
          <button
            type="button"
            onClick={() => {
              void connection.disconnect();
            }}
          >
            Cancel
          </button>
        )}
        <button
          className="t3-connect-primary"
          type="submit"
          disabled={pending || !pairingUrl.trim()}
        >
          Connect to T3 Code
        </button>
      </div>
    </form>
  );
}
