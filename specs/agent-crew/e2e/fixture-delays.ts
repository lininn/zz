// 显式释放的延迟屏障：测试时序由脚本控制，不使用 sleep 猜测请求完成。
type Kind =
  | "get"
  | "send"
  | "createConversation"
  | "recover"
  | "cancel"
  | "respondPermission"
  | "respondRelay"
  | "update";
const gates = new Map<
  string,
  {
    id: string;
    kind: Kind;
    targetId: string;
    waiting: boolean;
    promise: Promise<void>;
    resolve: () => void;
    reject: (reason: Error) => void;
  }
>();
const calls: { kind: Kind; groupId: string; conversationId?: string }[] = [];
export async function fixtureBarrier(
  kind: Kind,
  params: { groupId: string; conversationId?: string },
) {
  calls.push({ kind, ...params });
  const gate = [...gates.values()].find(
    (item) =>
      !item.waiting &&
      item.kind === kind &&
      item.targetId === (params.conversationId ?? params.groupId),
  );
  if (gate) {
    gate.waiting = true;
    await gate.promise;
  }
}
export const fixtureDelays = {
  deferNext(kind: Kind, targetId: string) {
    const id = crypto.randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    gates.set(id, { id, kind, targetId, waiting: false, promise, resolve, reject });
    return id;
  },
  release(id: string, error?: string) {
    const gate = gates.get(id);
    if (!gate?.waiting) throw new Error("Fixture gate has not been reached");
    gates.delete(id);
    if (error) gate.reject(new Error(error));
    else gate.resolve();
  },
  state: () => ({
    calls: structuredClone(calls),
    gates: [...gates.values()].map(({ id, kind, targetId, waiting }) => ({
      id,
      kind,
      targetId,
      waiting,
    })),
  }),
};
