import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as SqliteDatabase } from "node:sqlite";
import { getTasksIndexDatabasePath } from "#src/paths.js";
import { runTasksDatabaseMigrations } from "#src/session/tasksDatabase/migrations.js";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");
export const crewProcessOwnerId = `${process.pid}:${randomUUID()}`;
const localOwners = new Set([crewProcessOwnerId]);
export function createCrewOwner(): { id: string; dispose(): void } {
  const id = `${process.pid}:${randomUUID()}`;
  localOwners.add(id);
  return {
    id,
    dispose: () => {
      localOwners.delete(id);
    },
  };
}

export function isCrewProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
export function isCrewRuntimeTreeAlive(pid: number): boolean {
  // Unix Agent 由 detached process group 启动，检查整个组而非仅根 PID；
  // Windows 缺少可恢复的 Job Object 证明，崩溃租约保守保留，不冒险释放孤儿写进程。
  if (process.platform === "win32") return true;
  if (isCrewProcessAlive(pid)) return true;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** 人工确认恢复后的强制收口：杀掉 detached 进程组（含孤儿子进程），返回是否仍有存活。 */
export function killCrewRuntimeTree(pid: number): boolean {
  if (process.platform === "win32") return true;
  let survivors = false;
  for (const target of [pid, -pid]) {
    try {
      process.kill(target, "SIGKILL");
      survivors = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") survivors = true;
    }
  }
  return survivors;
}
export function isCrewOwnerAlive(ownerId: string): boolean {
  const pid = Number(ownerId.split(":")[0]);
  if (pid === process.pid) return localOwners.has(ownerId);
  return Number.isInteger(pid) && pid > 0 ? isCrewProcessAlive(pid) : true;
}

export interface CrewWorkspaceLease {
  workspaceKey: string;
  token: string;
  ownerId: string;
  sessionId: string;
  runtimePid: number | null;
}

/** 同一个 tasks-index 文件中的唯一行是跨窗口写准入事实，内存计时器不授予写权限。 */
export class CrewLeaseStore {
  private db?: SqliteDatabase;
  private ready?: Promise<void>;
  constructor(
    private readonly path = getTasksIndexDatabasePath(),
    readonly ownerId = crewProcessOwnerId,
    private readonly alive = isCrewProcessAlive,
    private readonly runtimeAlive = isCrewRuntimeTreeAlive,
  ) {}

  private ensureReady(): Promise<void> {
    return (this.ready ??= (async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const db = new DatabaseSync(this.path);
      try {
        db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL");
        await runTasksDatabaseMigrations(db);
        this.db = db;
      } catch (error) {
        db.close();
        this.ready = undefined;
        throw error;
      }
    })());
  }

  async acquire(input: {
    workspaceKey: string;
    sessionId: string;
    runtimePid?: number;
  }): Promise<CrewWorkspaceLease> {
    await this.ensureReady();
    const db = this.db!;
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.read(input.workspaceKey);
      if (current) {
        if (current.ownerId === this.ownerId && current.sessionId === input.sessionId) {
          db.exec("COMMIT");
          return current;
        }
        // Host 死亡不等于子进程退出：必须同时证明持有者和真实 runtime 都已退出。
        const ownerPid = Number(current.ownerId.split(":")[0]);
        const ownerDead =
          Number.isInteger(ownerPid) &&
          ownerPid > 0 &&
          !(this.alive === isCrewProcessAlive
            ? isCrewOwnerAlive(current.ownerId)
            : this.alive(ownerPid));
        if (!ownerDead || current.runtimePid === null || this.runtimeAlive(current.runtimePid)) {
          throw new Error("crew.workspaceBusy");
        }
        db.prepare("DELETE FROM agent_crew_workspace_leases WHERE workspace_key=? AND token=?").run(
          input.workspaceKey,
          current.token,
        );
      }
      const lease: CrewWorkspaceLease = {
        workspaceKey: input.workspaceKey,
        sessionId: input.sessionId,
        ownerId: this.ownerId,
        runtimePid: input.runtimePid ?? null,
        token: randomUUID(),
      };
      db.prepare("INSERT INTO agent_crew_workspace_leases VALUES(?,?,?,?,?,?)").run(
        lease.workspaceKey,
        lease.token,
        lease.ownerId,
        lease.sessionId,
        lease.runtimePid,
        Date.now(),
      );
      db.exec("COMMIT");
      return lease;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async release(lease: CrewWorkspaceLease): Promise<boolean> {
    await this.ensureReady();
    return (
      this.db!.prepare(
        "DELETE FROM agent_crew_workspace_leases WHERE workspace_key=? AND token=? AND owner_id=?",
      ).run(lease.workspaceKey, lease.token, lease.ownerId).changes === 1
    );
  }

  async bindSession(lease: CrewWorkspaceLease, sessionId: string): Promise<void> {
    await this.ensureReady();
    const changed = this.db!.prepare(
      "UPDATE agent_crew_workspace_leases SET session_id=? WHERE workspace_key=? AND token=? AND owner_id=?",
    ).run(sessionId, lease.workspaceKey, lease.token, lease.ownerId).changes;
    if (changed !== 1) throw new Error("crew.recoveryRequired");
    lease.sessionId = sessionId;
  }

  async get(workspaceKey: string): Promise<CrewWorkspaceLease | null> {
    await this.ensureReady();
    return this.read(workspaceKey);
  }

  /**
   * 启动清扫：删掉持有者进程已经不存在的租约。
   *
   * `acquire` 的接管分支要求 owner 死 **且** runtime 死 **且** runtimePid 非空，三者缺一
   * 就不接管。进程被强杀（或执行转 failed 时没走到 release）留下的行因此会永久占住
   * workspace，表现为「此工作区已有写入执行」且重启也解不开——没有任何在线路径会再碰它。
   *
   * 这里只按 owner 存活判定：owner 是写入准入的归属进程，它不在了，这条租约就不可能
   * 再被任何人正常释放。runtime 子进程是否残留交给后续 acquire/reap 判断，不在清扫范围。
   * 必须在本进程开始派工前调用，否则会误删同机其他活跃 Host 的租约。
   */
  async reclaimAbandoned(): Promise<number> {
    await this.ensureReady();
    const db = this.db!;
    db.exec("BEGIN IMMEDIATE");
    try {
      const abandoned = db
        .prepare("SELECT workspace_key, token, owner_id FROM agent_crew_workspace_leases")
        .all()
        .filter((row) => {
          const ownerId = String(row.owner_id);
          // 本进程自己的租约绝不清扫：启动期本就不该有，有也属于 localOwners 的活记录。
          if (ownerId === this.ownerId) return false;
          const ownerPid = Number(ownerId.split(":")[0]);
          if (!Number.isInteger(ownerPid) || ownerPid <= 0) return false;
          return !(this.alive === isCrewProcessAlive
            ? isCrewOwnerAlive(ownerId)
            : this.alive(ownerPid));
        });
      for (const row of abandoned) {
        db.prepare("DELETE FROM agent_crew_workspace_leases WHERE workspace_key=? AND token=?").run(
          String(row.workspace_key),
          String(row.token),
        );
      }
      db.exec("COMMIT");
      return abandoned.length;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private read(key: string): CrewWorkspaceLease | null {
    const row = this.db!.prepare(
      "SELECT * FROM agent_crew_workspace_leases WHERE workspace_key=?",
    ).get(key);
    return row
      ? {
          workspaceKey: String(row.workspace_key),
          token: String(row.token),
          ownerId: String(row.owner_id),
          sessionId: String(row.session_id),
          runtimePid:
            Number.isSafeInteger(Number(row.runtime_pid)) && Number(row.runtime_pid) > 0
              ? Number(row.runtime_pid)
              : null,
        }
      : null;
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
    this.ready = undefined;
  }
}
