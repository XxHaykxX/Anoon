// Аудит-леджер действий модератора (mock). Реальный — таблица ModeratorAction (приватность/комплаенс).
// Каждый бан/мут/просмотр приватного/эскалация пишется сюда.

export type ModActionType = "ban" | "unban" | "mute" | "dismiss_report" | "escalate" | "view_private";

export type ModAction = {
  id: string;
  type: ModActionType;
  target: string; // ник + #ID
  reason: string;
  at: string;
};

let log: ModAction[] = [];
const subs = new Set<() => void>();

export function addAction(a: Omit<ModAction, "id" | "at">): void {
  log = [{ ...a, id: `ma-${log.length + 1}`, at: new Date().toISOString() }, ...log];
  subs.forEach((f) => f());
}

export function getActions(): ModAction[] {
  return log;
}

export function subscribeActions(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
