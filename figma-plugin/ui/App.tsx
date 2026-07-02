import type React from "react";
import { useMemo, useRef, useState } from "react";
import { buildVariableSyncModel, resultSummary, type ToolResult } from "./view-model.js";

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

const buttonStyle: React.CSSProperties = {
  border: "1px solid #111",
  borderRadius: 6,
  background: "#111",
  color: "#fff",
  padding: "9px 10px",
  fontSize: 12,
  cursor: "pointer",
};

const mutedButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.45,
  cursor: "default",
};

const inputStyle: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  padding: 8,
  border: "1px solid #cfcfcf",
  borderRadius: 6,
  fontSize: 12,
};

const statusColor = {
  waiting: "#6b7280",
  ready: "#0b65c2",
  done: "#17803b",
  attention: "#b00020",
};

export function App(): React.ReactElement {
  const [connectUrl, setConnectUrl] = useState("");
  const [connected, setConnected] = useState(false);
  const [tools, setTools] = useState<string[]>([]);
  const [variablesResult, setVariablesResult] = useState<ToolResult | null>(null);
  const [busy, setBusy] = useState<"connect" | "variables" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rpcId = useRef(1);
  const pending = useRef<Map<number, PendingRpc>>(new Map());

  const model = useMemo(
    () => buildVariableSyncModel({ connected, tools, variablesResult }),
    [connected, tools, variablesResult]
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

  const syncVariables = async (): Promise<void> => {
    setBusy("variables");
    setError(null);
    try {
      const payload = await requestLocalVariables();
      const result = await callTool("kotikit_sync_plugin_variables", { payload });
      setVariablesResult(result);
      setError(result.isError ? resultSummary(result) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sync variables.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ fontFamily: "Inter, sans-serif", padding: 16, color: "#222" }}>
      <header>
        <h2 style={{ margin: 0, fontSize: 18 }}>kotikit variables</h2>
        <div style={{ color: connected ? "#17803b" : "#777", fontSize: 12, marginTop: 4 }}>
          {model.statusText}
        </div>
      </header>

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
          style={inputStyle}
        />
        <button
          type="button"
          onClick={handleConnect}
          disabled={busy === "connect" || connected}
          style={{
            ...(busy === "connect" || connected ? mutedButtonStyle : buttonStyle),
            marginTop: 10,
            width: "100%",
          }}
        >
          {busy === "connect" ? "Connecting..." : connected ? "Connected" : "Connect"}
        </button>
      </section>

      <section style={{ marginTop: 18 }}>
        <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Variables</h3>
        <p
          style={{
            color: statusColor[model.variablesStatus],
            fontSize: 12,
            lineHeight: 1.4,
            margin: "0 0 10px",
          }}
        >
          {model.variablesMessage}
        </p>
        <button
          type="button"
          onClick={syncVariables}
          disabled={busy !== null || !model.canSyncVariables}
          style={{
            ...(busy !== null || !model.canSyncVariables ? mutedButtonStyle : buttonStyle),
            width: "100%",
          }}
        >
          {busy === "variables" ? "Syncing..." : "Sync Variables From Open File"}
        </button>
      </section>

      {error !== null ? (
        <p style={{ color: "#b00020", fontSize: 12, marginTop: 12 }}>{error}</p>
      ) : null}
    </div>
  );
}
