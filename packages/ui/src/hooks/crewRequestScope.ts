import { crewErrorKey } from "@/crew/crewErrors.js";
import { withForegroundDeadline } from "../lib/foregroundRequest.js";

export function createCrewRequestScope() {
  return { pending: false, error: null as string | null };
}

/** 切换后已提交的旧命令仍可能完成，但只能刷新原缓存，不能改变新选择的错误、草稿或导航。 */
export async function runCrewCommand<T>(
  scope: ReturnType<typeof createCrewRequestScope>,
  isCurrent: () => boolean,
  operation: () => Promise<T>,
  refresh: () => Promise<unknown>,
  notify: () => void,
) {
  if (!isCurrent() || scope.pending) return { ok: false, isCurrent, error: null } as const;
  scope.pending = true;
  scope.error = null;
  notify();
  try {
    const value = await withForegroundDeadline(operation);
    // 提交成功后的读取失败不是写入失败，不能诱发重复创建/发送。
    void refresh().catch(() => {});
    return { ok: true, value, isCurrent } as const;
  } catch (error) {
    scope.error = crewErrorKey(error);
    void refresh().catch(() => {});
    return { ok: false, isCurrent, error: scope.error } as const;
  } finally {
    scope.pending = false;
    if (isCurrent()) notify();
  }
}
