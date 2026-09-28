import { useEffect, useState, useRef } from "react";
import type { IServiceAccessor } from "@zcode/services";
import type { FileEntry } from "@zcode/shared";
import { FolderIcon, FolderSymlinkIcon } from "lucide-react";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { useZCodeIntl } from "./i18n/IntlProvider.js";
import { logger } from "./logger.js";
import {
  foregroundErrorKind,
  safeForegroundErrorDetail,
  withForegroundDeadline,
} from "./lib/foregroundRequest.js";

function createDirectoryBrowserReadParams(
  path: string,
  showHiddenDirectories: boolean,
): { path: string; includeHidden?: boolean } {
  return showHiddenDirectories ? { path, includeHidden: true } : { path };
}

function filterDirectoryBrowserEntries(entries: FileEntry[]): FileEntry[] {
  return entries.filter((e) => e.type === "directory");
}

// 远程目录条目已经携带 isSymbolicLink，这里只替换展示图标，不改变进入和选择目录的路径语义。
function getDirectoryBrowserEntryIconKind(
  entry: Pick<FileEntry, "isSymbolicLink" | "type">,
): "folder" | "folder-symlink" {
  return entry.type === "directory" && entry.isSymbolicLink === true ? "folder-symlink" : "folder";
}

function createDirectoryBrowserRequestGuard(): {
  begin: () => number;
  isCurrent: (requestId: number) => boolean;
} {
  let latestRequestId = 0;

  return {
    begin: () => {
      latestRequestId += 1;
      return latestRequestId;
    },
    isCurrent: (requestId: number) => requestId === latestRequestId,
  };
}

/**
 * 服务端目录浏览对话框。
 * 通过 fileService.readdir 浏览远程/本地服务器的目录结构，
 * 适用于 web 端无法调用系统原生文件选择器的场景。
 */
export function DirectoryBrowser({
  services,
  onSelect,
  onCancel,
  onPathChange,
  embedded = false,
}: {
  services: IServiceAccessor;
  onSelect: (path: string) => void;
  onCancel: () => void;
  onPathChange?: (path: string) => void;
  embedded?: boolean;
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [inputPath, setInputPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{
    kind: ReturnType<typeof foregroundErrorKind>;
    message: string;
  } | null>(null);
  const [showHiddenDirectories, setShowHiddenDirectories] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const showHiddenDirectoriesRef = useRef(false);
  const requestGuardRef = useRef(createDirectoryBrowserRequestGuard());
  const requestAbortRef = useRef<AbortController | null>(null);
  const requestedPathRef = useRef<string | null>(null);
  const { intl } = useZCodeIntl();

  const beginRequest = () => {
    const requestId = requestGuardRef.current.begin();
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setLoading(true);
    setError(null);
    setEntries([]);
    // 上一次成功路径不能在新读取失败/超时时继续被选中，embedded 的外层确认按钮也必须失效。
    onPathChange?.("");
    return { requestId, signal: controller.signal };
  };

  const reportError = (err: unknown, phase: "system" | "directory") => {
    const kind = foregroundErrorKind(err);
    const detail = safeForegroundErrorDetail(err);
    const keys = {
      authentication: "directoryBrowser.errorAuthentication",
      permission: "directoryBrowser.errorPermission",
      closed: "directoryBrowser.errorClosed",
      timeout: "directoryBrowser.errorTimeout",
      unavailable: "directoryBrowser.errorUnavailable",
      unknown:
        phase === "system" ? "directoryBrowser.errorSystem" : "directoryBrowser.errorReadDir",
    };
    logger.warn("[DirectoryBrowser] 目录请求失败:", kind, detail);
    setError({ kind, message: intl.formatMessage({ id: keys[kind] }, { error: detail }) });
  };

  const navigateTo = async (
    path: string,
    nextShowHiddenDirectories = showHiddenDirectoriesRef.current,
  ) => {
    requestedPathRef.current = path;
    const { requestId, signal } = beginRequest();
    try {
      const result = await withForegroundDeadline(
        () =>
          services.fileService.readdir(
            createDirectoryBrowserReadParams(path, nextShowHiddenDirectories),
          ),
        signal,
      );
      if (!requestGuardRef.current.isCurrent(requestId)) return;
      setEntries(filterDirectoryBrowserEntries(result));
      setCurrentPath(path);
      setInputPath(path);
      onPathChange?.(path);
      listRef.current?.scrollTo(0, 0);
    } catch (err) {
      // 快速导航、初始化晚到或卸载后，旧请求的成功和失败都不能覆盖最新状态。
      if (requestGuardRef.current.isCurrent(requestId)) reportError(err, "directory");
    } finally {
      if (requestGuardRef.current.isCurrent(requestId)) setLoading(false);
    }
  };

  const initialize = async () => {
    requestedPathRef.current = null;
    setCurrentPath("");
    const { requestId, signal } = beginRequest();
    try {
      const info = await withForegroundDeadline(() => services.systemService.info(), signal);
      if (requestGuardRef.current.isCurrent(requestId)) void navigateTo(info.homedir);
    } catch (err) {
      if (requestGuardRef.current.isCurrent(requestId)) reportError(err, "system");
    } finally {
      if (requestGuardRef.current.isCurrent(requestId)) setLoading(false);
    }
  };

  useEffect(() => {
    void initialize();
    return () => {
      // 只使前台读取失效并清掉定时器，不把卸载误当成远端 RPC 已取消。
      requestGuardRef.current.begin();
      requestAbortRef.current?.abort();
    };
    // 初始化仅跟随服务连接所有者切换；语言或回调引用变化不重新请求 homedir。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services]);

  const handleRetry = () => {
    if (requestedPathRef.current === null) void initialize();
    else void navigateTo(requestedPathRef.current);
  };

  const handleGoUp = () => {
    // 提取父目录路径
    const parent = currentPath.replace(/\/[^/]+\/?$/, "") || "/";
    navigateTo(parent);
  };

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // portal 只改变 DOM 层级，React submit 仍会冒泡到 CrewGroupEditor，触发意外保存。
    e.stopPropagation();
    const trimmed = inputPath.trim();
    if (trimmed) navigateTo(trimmed);
  };

  const handleToggleHiddenDirectories = () => {
    const nextShowHiddenDirectories = !showHiddenDirectoriesRef.current;
    showHiddenDirectoriesRef.current = nextShowHiddenDirectories;
    setShowHiddenDirectories(nextShowHiddenDirectories);

    if (requestedPathRef.current) {
      void navigateTo(requestedPathRef.current, nextShowHiddenDirectories);
    }
  };

  const handleSelectCurrentPath = () => {
    const selectedPath = currentPath.trim();
    if (!selectedPath || loading || error) {
      return;
    }

    onSelect(selectedPath);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
  };

  const browserContent = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <div className="mb-1 block text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "directoryBrowser.title" })}
        </div>

        {/* 路径输入 */}
        <form onSubmit={handleInputSubmit} className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="text"
            size="lg"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            placeholder={intl.formatMessage({
              id: "directoryBrowser.pathPlaceholder",
            })}
            className="h-9 min-w-0 flex-1 text-ui-base"
            autoFocus
          />
          <div className="flex gap-2 sm:shrink-0">
            <Button
              type="submit"
              size="lg"
              className="h-9 min-w-0 flex-1 px-4 text-ui-base sm:flex-none"
            >
              {intl.formatMessage({ id: "directoryBrowser.go" })}
            </Button>
            <Button
              type="button"
              variant={showHiddenDirectories ? "secondary" : "outline"}
              size="lg"
              aria-pressed={showHiddenDirectories}
              className="h-9 min-w-0 flex-1 px-3 text-ui-base sm:flex-none"
              onClick={handleToggleHiddenDirectories}
            >
              {intl.formatMessage({
                id: showHiddenDirectories
                  ? "directoryBrowser.hideHidden"
                  : "directoryBrowser.showHidden",
              })}
            </Button>
          </div>
        </form>
      </div>

      {/* 错误提示 */}
      {error ? (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 text-ui-base text-destructive"
        >
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{error.message}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={error.kind === "closed" || error.kind === "authentication"}
            onClick={handleRetry}
          >
            {intl.formatMessage({ id: "common.retry" })}
          </Button>
        </div>
      ) : null}

      {/* 目录列表 */}
      <div
        ref={listRef}
        aria-busy={loading}
        className="flex-1 flex flex-col overflow-y-auto rounded-lg border border-border bg-background"
      >
        {/* 上级目录 */}
        {currentPath && currentPath !== "/" ? (
          <button
            onClick={handleGoUp}
            // 滚动容器是纵向 flex 布局，子项默认允许 shrink；
            // 当目录很多触发滚动时，首行“返回上级”会被压缩导致高度变化。
            className="flex h-10 w-full shrink-0 cursor-pointer items-center gap-2 border-b border-border px-3 text-left text-ui-base transition hover:bg-hover/50"
          >
            <FolderIcon className="size-4 shrink-0 text-foreground-subtle" />
            <span className="text-foreground">..</span>
          </button>
        ) : null}

        {loading ? (
          <div className="p-4 text-center text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "common.loading" })}
          </div>
        ) : error ? null : entries.length === 0 ? (
          <div className="p-4 text-center text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "directoryBrowser.noSubdirs" })}
          </div>
        ) : (
          entries.map((entry) => {
            const EntryIcon =
              getDirectoryBrowserEntryIconKind(entry) === "folder-symlink"
                ? FolderSymlinkIcon
                : FolderIcon;

            return (
              <button
                key={entry.path}
                onClick={() => navigateTo(entry.path)}
                className="flex w-full shrink-0 cursor-pointer items-center gap-2 px-3 py-2 text-left text-ui-base transition hover:bg-hover/50"
              >
                <EntryIcon className="size-4 shrink-0 text-foreground-subtle" />
                <span className="truncate">{entry.name}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  if (embedded) {
    return browserContent;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      onKeyDown={handleKeyDown}
    >
      <div className="flex h-[min(36rem,calc(100vh-4rem))] w-[min(44rem,calc(100vw-2rem))] flex-col rounded-xl border border-border bg-popover p-4 shadow-xl">
        {browserContent}
        {/* 非嵌入模式之前只能继续进入子目录，没有确认当前目录的路径。
            Web 目录浏览器作为独立选择器使用时因此永远拿不到 onSelect 结果。
            这里把确认动作收口到弹窗 footer，选择当前浏览路径并交回上层。 */}
        <div className="mt-3 flex shrink-0 justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-10 min-w-0 px-5 text-ui-base"
            onClick={onCancel}
          >
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
          <Button
            type="button"
            size="lg"
            className="h-10 min-w-0 px-5 text-ui-base"
            disabled={!currentPath.trim() || loading || Boolean(error)}
            onClick={handleSelectCurrentPath}
          >
            {intl.formatMessage({ id: "directoryBrowser.selectDir" })}
          </Button>
        </div>
      </div>
    </div>
  );
}
