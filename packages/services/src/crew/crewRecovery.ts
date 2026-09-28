import type { ICrewService } from "./contract.js";

/** 启动恢复枚举全部会话；不能沿用只恢复默认群板的旧入口而遗漏其他任务队列。 */
export async function recoverCrewConversations(service: ICrewService): Promise<void> {
  const groups = await service.list({});
  const results = await Promise.allSettled(
    groups.map(async ({ groupId }) => {
      const conversations = await service.listConversations({ groupId });
      const recovered = await Promise.allSettled(
        conversations.map(({ conversationId }) => service.recover({ groupId, conversationId })),
      );
      if (recovered.some((result) => result.status === "rejected"))
        throw new Error("crew.recoveryRequired");
    }),
  );
  if (results.some((result) => result.status === "rejected"))
    throw new Error("crew.recoveryRequired");
}
