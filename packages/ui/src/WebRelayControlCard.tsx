import { useCallback, useEffect, useState } from "react";
import { GlobeIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

// 本机 connector 管理服务（仅 127.0.0.1 可达；手机端经中转访问时连接必然失败）
const CONNECTOR_ADMIN_BASE =
  (import.meta.env?.VITE_CONNECTOR_ADMIN_URL as string | undefined)?.replace(/\/+$/u, "") ??
  "http://127.0.0.1:3789";

type RelayStatus =
  | { kind: "unavailable" }
  | { kind: "ready"; bound: boolean; username: string | null; relayConnected: boolean };

async function fetchStatus(): Promise<RelayStatus> {
  const response = await fetch(`${CONNECTOR_ADMIN_BASE}/api/status`, {
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  const data = (await response.json()) as {
    bound: boolean;
    username: string | null;
    relayConnected: boolean;
  };
  return {
    kind: "ready",
    bound: data.bound,
    username: data.username,
    relayConnected: data.relayConnected,
  };
}

export function WebRelayControlCard() {
  const { intl } = useZCodeIntl();
  const [status, setStatus] = useState<RelayStatus>({ kind: "unavailable" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchStatus()
      .then(setStatus)
      .catch(() => setStatus({ kind: "unavailable" }));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleLogin = async () => {
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${CONNECTOR_ADMIN_BASE}/api/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      if (data.ok) {
        logger.info("[WebRelayControlCard] 远程控制已开启");
        setPassword("");
        refresh();
      } else {
        setError(data.message ?? intl.formatMessage({ id: "webRemoteControl.relay.loginFailed" }));
      }
    } catch {
      setError(intl.formatMessage({ id: "webRemoteControl.relay.unreachable" }));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await fetch(`${CONNECTOR_ADMIN_BASE}/api/logout`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });
      refresh();
    } catch {
      setError(intl.formatMessage({ id: "webRemoteControl.relay.unreachable" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-start gap-2">
        <GlobeIcon className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
        <div className="min-w-0 space-y-1">
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "webRemoteControl.relay.title" })}
          </div>
          <p className="text-ui-base/relaxed text-foreground-subtle">
            {intl.formatMessage({ id: "webRemoteControl.relay.description" })}
          </p>
        </div>
      </div>

      {status.kind === "unavailable" ? (
        <p className="text-ui-base/relaxed text-foreground-subtle">
          {intl.formatMessage({ id: "webRemoteControl.relay.unavailable" })}
        </p>
      ) : (
        <div className="grid gap-3">
          <div className="rounded-lg bg-surface px-3 py-2.5 text-ui-base/relaxed text-foreground-subtle">
            {status.bound ? (
              <span>
                {intl.formatMessage({ id: "webRemoteControl.relay.status.bound" })}
                <span className="mx-1 font-medium text-foreground">{status.username}</span>·
                {intl.formatMessage({ id: "webRemoteControl.relay.relayOnline" })}
                <span
                  className={
                    status.relayConnected ? "mx-1 text-green-600" : "mx-1 text-destructive"
                  }
                >
                  {intl.formatMessage({
                    id: status.relayConnected
                      ? "webRemoteControl.relay.online"
                      : "webRemoteControl.relay.offline",
                  })}
                </span>
              </span>
            ) : (
              intl.formatMessage({ id: "webRemoteControl.relay.status.unbound" })
            )}
          </div>

          {status.bound ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={busy}
              className="w-full justify-center gap-2 enabled:cursor-pointer"
              onClick={() => {
                void handleLogout();
              }}
            >
              {intl.formatMessage({ id: "webRemoteControl.relay.logout" })}
            </Button>
          ) : (
            <div className="grid gap-2">
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={intl.formatMessage({ id: "webRemoteControl.relay.username" })}
                autoComplete="username"
              />
              <Input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={intl.formatMessage({ id: "webRemoteControl.relay.password" })}
                type="password"
                autoComplete="current-password"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleLogin();
                  }
                }}
              />
              <Button
                type="button"
                size="lg"
                disabled={busy || !username.trim() || !password}
                className="w-full justify-center gap-2 enabled:cursor-pointer"
                onClick={() => {
                  void handleLogin();
                }}
              >
                {intl.formatMessage({ id: "webRemoteControl.relay.login" })}
              </Button>
            </div>
          )}
          {error ? <p className="text-ui-xs text-destructive">{error}</p> : null}
        </div>
      )}
    </section>
  );
}
