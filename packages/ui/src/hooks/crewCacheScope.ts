import { createCrewId } from "@/crew/crewUiHelpers.js";

const serviceScopes = new WeakMap<object, string>();
/** 同一 Host 的设置页/首页共享读投影；换连接实例不能复用旧 Host 的群组数据。 */
export function crewCacheScope(service: object | undefined): string {
  if (!service) return "unavailable";
  let scope = serviceScopes.get(service);
  if (!scope) {
    scope = createCrewId();
    serviceScopes.set(service, scope);
  }
  return scope;
}
