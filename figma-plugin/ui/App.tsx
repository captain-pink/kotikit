import React, { useState } from "react";

export function App(): React.ReactElement {
  const [connectUrl, setConnectUrl] = useState("");
  const [connected, setConnected] = useState(false);

  const handleConnect = (): void => {
    if (connectUrl.startsWith("ws://localhost") || connectUrl.startsWith("ws://127.0.0.1")) {
      setConnected(true);
    }
  };

  if (!connected) {
    return (
      <div>
        <h2>kotikit</h2>
        <p>Paste the bridge URL printed by <code>bun run bridge</code>:</p>
        <input
          type="text"
          value={connectUrl}
          onChange={(e) => setConnectUrl(e.target.value)}
          placeholder="ws://localhost:53124?token=..."
          style={{ width: "100%", padding: 6 }}
        />
        <button onClick={handleConnect} style={{ marginTop: 8, padding: "6px 12px" }}>
          Connect
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2>kotikit — connected</h2>
      <p>Bridge URL: <code>{connectUrl}</code></p>
      <p style={{ color: "#888" }}>
        The full plan checklist UI is a Phase 5 follow-up (P5-D4). For now, this confirms the bridge connection works.
      </p>
    </div>
  );
}
