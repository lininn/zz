// relay 打开通道和本地握手各可等待 10 秒，前台兜底必须覆盖两段预算；不改变长连接/流的期限。
const FOREGROUND_DEADLINE_MS = 25_000;

export class ForegroundTimeoutError extends Error {
  constructor() {
    super("Foreground request timed out");
    this.name = "ForegroundTimeoutError";
  }
}

/** 仅停止前台等待，不取消或回滚远端写入。迟到结果由已结算的 Promise 吸收，禁止自动重放。 */
export async function withForegroundDeadline<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      abort = () => reject(new DOMException("Request superseded", "AbortError"));
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new ForegroundTimeoutError()), FOREGROUND_DEADLINE_MS);
    });
    // 已卸载/过期的读取不能再发出；真实 RPC 的生命周期仍由连接所有者管理。
    if (signal?.aborted) return await deadline;
    return await Promise.race([operation(), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

export function foregroundErrorKind(error: unknown) {
  const value = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const text = [
    value.name,
    value.code,
    value.status,
    value.message,
    typeof error === "string" ? error : "",
  ].join(" ");
  if (
    /unauthori[sz]ed|authentication|unauthenticated|\b401\b|token.*(?:expired|invalid)/i.test(text)
  )
    return "authentication";
  if (/EACCES|EPERM|permission denied|access denied|forbidden|\b403\b/i.test(text))
    return "permission";
  if (
    /ConnectionClosed|ChannelClient is disposed|connection.*(?:closed|disposed|lost)|socket.*(?:closed|disconnected)|service.*closed|\bdisconnected\b/i.test(
      text,
    )
  )
    return "closed";
  if (/ForegroundTimeoutError|TimeoutError|ETIMEDOUT|timed?\s*out|timeout/i.test(text))
    return "timeout";
  if (
    /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|failed to fetch|network|unreachable|unavailable/i.test(
      text,
    )
  )
    return "unavailable";
  return "unknown";
}

/** 保留可诊断的错误码/描述，但不要把服务地址、文件路径或凭据直接显示/记录到 UI。 */
export function safeForegroundErrorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message
    .replace(/(?:https?|wss?):\/\/[^\s<>]+/gi, "[address]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, "[credential]")
    .replace(
      /\b(?:authorization|cookie|(?:access[_-]?|refresh[_-]?)?token|api[_-]?key|password|secret)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "[credential]",
    )
    .replace(/(?:[A-Za-z]:\\|\/)[^\s'"<>:,;]*/g, "[path]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240);
}
