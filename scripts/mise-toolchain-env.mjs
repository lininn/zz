import { delimiter, dirname, join, resolve } from "node:path";
import { readdirSync, statSync, existsSync, realpathSync } from "node:fs";

/**
 * 发现 mise 安装的所有工具 bin 目录（如 pnpm 等），确保它们和 Node 一样
 * 在子进程 PATH 的最前面，不会被 /opt/homebrew/bin 等系统路径中的旧版本覆盖。
 */
function discoverMiseToolDirs(nodeDirectory) {
  // nodeDirectory 类似 ~/.local/share/mise/installs/node/24.14.0/bin
  const installsRoot = resolve(nodeDirectory, "..", "..", "..");
  const seen = new Set();
  const toolDirs = [];
  try {
    for (const tool of readdirSync(installsRoot)) {
      const toolDir = join(installsRoot, tool);
      try {
        if (!statSync(toolDir).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const version of readdirSync(toolDir)) {
        const versionDir = join(toolDir, version);
        // 部分工具把二进制放在 versionDir/bin/，部分直接放在 versionDir/
        const binDir = join(versionDir, "bin");
        let actualDir;
        try {
          actualDir = statSync(binDir).isDirectory() ? binDir : versionDir;
        } catch {
          actualDir = versionDir;
        }
        let real = actualDir;
        try { real = realpathSync(actualDir); } catch { /* ignore */ }
        if (!seen.has(real)) {
          seen.add(real);
          toolDirs.push(real);
        }
      }
    }
  } catch {
    // 非 mise 环境时静默跳过
  }
  return toolDirs;
}

/**
 * 让所有子进程使用和启动器相同的 Node runtime。
 *
 * `mise run` 通过 shell 执行 TOML task；当另一套 Node 出现在
 * 子 shell 的 PATH 前面时，pnpm 会用错误的 runtime 启动 package script，
 * 即使 task 本身已经由 mise 选中了正确版本。把启动器的 Node 目录置首，
 * 可以在不依赖用户 home 目录布局的前提下固定整条子进程链路。
 *
 * 同时把 mise 管理的其他工具（如 pnpm）的 bin 目录也提到前面，
 * 避免系统 PATH 中的旧版本（如 brew 安装的 pnpm）覆盖 mise 的版本。
 */
export function withPinnedNodePath(env, nodeExecutablePath) {
  const nodeDirectory = dirname(nodeExecutablePath);
  // Windows 的 Node 环境对象通常使用 `Path`，只读取大写 `PATH` 会把 pnpm.cmd
  // 所在目录从子进程环境中丢掉，导致 dev:desktop 的内部 pnpm 调用失败。
  const pathKey = typeof env.PATH === "string" ? "PATH" : "Path";
  const existingPath = typeof env[pathKey] === "string" ? env[pathKey] : "";

  // 收集所有要在 PATH 前面追加的目录
  const prependDirs = [nodeDirectory, ...discoverMiseToolDirs(nodeDirectory)];
  const prependSet = new Set(prependDirs);

  const pathEntries = existingPath
    .split(delimiter)
    .filter(Boolean)
    .filter((entry) => !prependSet.has(entry));

  return {
    ...env,
    [pathKey]: [...prependDirs, ...pathEntries].join(delimiter),
  };
}