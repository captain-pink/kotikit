import type React from "react";
import { useMemo, useRef, useState } from "react";
import { buildDashboardModel, type ToolResult } from "./view-model.js";

interface BridgeTool {
  name: string;
}

interface RpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

type PendingRpc = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type PluginVariableMessage =
  | { type: "local-variables-exported"; payload: unknown }
  | { type: "local-variables-export-failed"; message: string };

const statusColor = {
  pending: "#777",
  ready: "#0b65c2",
  done: "#17803b",
  attention: "#b55a00",
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid #222",
  borderRadius: 6,
  background: "#111",
  color: "#fff",
  padding: "8px 10px",
  fontSize: 12,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#fff",
  color: "#111",
};

export function App(): React.ReactElement {
  const [connectUrl, setConnectUrl] = useState("");
  const [connected, setConnected] = useState(false);
  const [tools, setTools] = useState<string[]>([]);
  const [doctor, setDoctor] = useState<ToolResult | null>(null);
  const [reviewReport, setReviewReport] = useState<ToolResult | null>(null);
  const [variablesResult, setVariablesResult] = useState<ToolResult | null>(null);
  const [scope, setScope] = useState("");
  const [screen, setScreen] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rpcId = useRef(1);
  const pending = useRef<Map<number, PendingRpc>>(new Map());

  const model = useMemo(
    () => buildDashboardModel({ connected, tools, doctor, reviewReport }),
    [connected, tools, doctor, reviewReport]
  );

  const callRpc = (method: string, params?: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (ws === null || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Bridge is not connected."));
        return;
      }
      const id = rpcId.current++;
      pending.current.set(id, { resolve, reject });
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });

  const callTool = async (
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<ToolResult> => {
    const result = await callRpc("tools/call", { name, arguments: args });
    return result as ToolResult;
  };

  const requestLocalVariables = (): Promise<unknown> =>
    new Promise((resolve, reject) => {
      let timeout: number | undefined;
      const cleanup = (onMessage: (event: MessageEvent) => void): void => {
        if (timeout !== undefined) window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
      };
      const onMessage = (event: MessageEvent): void => {
        const message = (event.data as { pluginMessage?: PluginVariableMessage }).pluginMessage;
        if (message === undefined) return;
        if (message.type === "local-variables-exported") {
          cleanup(onMessage);
          resolve(message.payload);
          return;
        }
        if (message.type === "local-variables-export-failed") {
          cleanup(onMessage);
          reject(new Error(message.message));
        }
      };

      window.addEventListener("message", onMessage);
      timeout = window.setTimeout(() => {
        cleanup(onMessage);
        reject(
          new Error("Figma did not return variables. Reopen the kotikit plugin and try again.")
        );
      }, 30_000);
      parent.postMessage({ pluginMessage: { type: "export-local-variables" } }, "*");
    });

  const handleConnect = (): void => {
    if (!connectUrl.startsWith("ws://localhost") && !connectUrl.startsWith("ws://127.0.0.1")) {
      setError("Use the localhost bridge URL returned by your assistant.");
      return;
    }

    setBusy("connect");
    setError(null);
    const ws = new WebSocket(connectUrl);
    wsRef.current = ws;
    ws.onopen = async () => {
      try {
        const result = await callRpc("tools/list");
        const listedTools = (result as { tools?: BridgeTool[] }).tools ?? [];
        setTools(listedTools.map((tool) => tool.name));
        setConnected(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not list bridge tools.");
      } finally {
        setBusy(null);
      }
    };
    ws.onmessage = (event) => {
      const response = JSON.parse(event.data as string) as RpcResponse;
      if (typeof response.id !== "number") return;
      const handler = pending.current.get(response.id);
      if (handler === undefined) return;
      pending.current.delete(response.id);
      if (response.error !== undefined) {
        handler.reject(new Error(response.error.message));
        return;
      }
      handler.resolve(response.result);
    };
    ws.onerror = () => {
      setBusy(null);
      setError("Could not connect to the kotikit bridge.");
    };
    ws.onclose = () => {
      setConnected(false);
      setTools([]);
      wsRef.current = null;
    };
  };

  const runDoctor = async (): Promise<void> => {
    setBusy("doctor");
    setError(null);
    try {
      setDoctor(await callTool("kotikit_doctor"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Doctor failed.");
    } finally {
      setBusy(null);
    }
  };

  const loadReviewReport = async (): Promise<void> => {
    setBusy("review");
    setError(null);
    try {
      const args = {
        ...(scope.trim() ? { scope: scope.trim() } : {}),
        ...(screen.trim() ? { screen: screen.trim() } : {}),
      };
      setReviewReport(await callTool("kotikit_design_review_report", args));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load review report.");
    } finally {
      setBusy(null);
    }
  };

  const syncVariables = async (): Promise<void> => {
    setBusy("variables");
    setError(null);
    try {
      const payload = await requestLocalVariables();
      setVariablesResult(await callTool("kotikit_sync_plugin_variables", { payload }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sync variables.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ fontFamily: "Inter, sans-serif", padding: 16, color: "#222" }}>
      <header
        style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>kotikit</h2>
          <div style={{ color: connected ? "#17803b" : "#777", fontSize: 12 }}>
            {model.statusText}
          </div>
        </div>
        <button
          type="button"
          onClick={runDoctor}
          disabled={!connected || busy !== null}
          style={
            connected
              ? secondaryButtonStyle
              : { ...secondaryButtonStyle, opacity: 0.45, cursor: "default" }
          }
        >
          Doctor
        </button>
      </header>

      {!connected ? (
        <section style={{ marginTop: 18 }}>
          <label htmlFor="bridge-url" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
            Bridge URL
          </label>
          <input
            id="bridge-url"
            type="text"
            value={connectUrl}
            onChange={(event) => setConnectUrl(event.target.value)}
            placeholder="ws://localhost:53124?token=..."
            style={{
              boxSizing: "border-box",
              width: "100%",
              padding: 8,
              border: "1px solid #ccc",
              borderRadius: 6,
            }}
          />
          <button
            type="button"
            onClick={handleConnect}
            disabled={busy === "connect"}
            style={{ ...buttonStyle, marginTop: 10, width: "100%" }}
          >
            {busy === "connect" ? "Connecting..." : "Connect"}
          </button>
        </section>
      ) : (
        <main style={{ marginTop: 18 }}>
          <section>
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Checklist</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {model.checklist.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "80px 1fr",
                    gap: 8,
                    padding: 10,
                    border: "1px solid #e1e1e1",
                    borderRadius: 8,
                  }}
                >
                  <strong style={{ color: statusColor[item.status], fontSize: 12 }}>
                    {item.status}
                  </strong>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{item.label}</div>
                    <div style={{ color: "#666", fontSize: 12 }}>{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Review</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input
                type="text"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                placeholder="scope"
                style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
              />
              <input
                type="text"
                value={screen}
                onChange={(event) => setScreen(event.target.value)}
                placeholder="screen"
                style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
              />
            </div>
            <button
              type="button"
              onClick={loadReviewReport}
              disabled={busy !== null}
              style={{ ...buttonStyle, marginTop: 10, width: "100%" }}
            >
              {busy === "review" ? "Loading..." : "Load Review Report"}
            </button>

            {model.reviewSummary !== null ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  gap: 8,
                  marginTop: 12,
                }}
              >
                {Object.entries(model.reviewSummary).map(([key, value]) => (
                  <div key={key} style={{ borderTop: "1px solid #ddd", paddingTop: 8 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
                    <div style={{ color: "#666", fontSize: 10 }}>{key}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Variables</h3>
            <button
              type="button"
              onClick={syncVariables}
              disabled={busy !== null || !tools.includes("kotikit_sync_plugin_variables")}
              style={{ ...buttonStyle, width: "100%" }}
            >
              {busy === "variables" ? "Syncing..." : "Sync Variables From Open File"}
            </button>
            {variablesResult !== null ? (
              <p
                style={{
                  color: variablesResult.isError ? "#b00020" : "#17803b",
                  fontSize: 12,
                  margin: "8px 0 0",
                }}
              >
                {variablesResult.content[0]?.text.split("\n\n")[0] ?? "Variables synced."}
              </p>
            ) : null}
          </section>
        </main>
      )}

      {error !== null ? (
        <p style={{ color: "#b00020", fontSize: 12, marginTop: 12 }}>{error}</p>
      ) : null}
    </div>
  );
}
