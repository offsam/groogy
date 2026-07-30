/**
 * Inbox assignment — UI/architecture layer.
 * No DB column yet; persists in localStorage per browser.
 * Swap STORAGE implementation for a server table without changing call sites.
 */

export type InboxAssignment = {
  assigneeId: string;
  assigneeLabel: string;
  assignedAt: string;
};

export type InboxAssignmentMap = Record<string, InboxAssignment>;

export const INBOX_ASSIGNMENT_STORAGE_KEY = "krugi.admin.inbox.assignments.v1";

export function readInboxAssignments(): InboxAssignmentMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(INBOX_ASSIGNMENT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as InboxAssignmentMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeInboxAssignments(map: InboxAssignmentMap): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    INBOX_ASSIGNMENT_STORAGE_KEY,
    JSON.stringify(map),
  );
}

export function assignInboxTasks(
  taskIds: string[],
  assignee: { id: string; label: string },
): InboxAssignmentMap {
  const map = readInboxAssignments();
  const assignedAt = new Date().toISOString();
  for (const id of taskIds) {
    map[id] = {
      assigneeId: assignee.id,
      assigneeLabel: assignee.label,
      assignedAt,
    };
  }
  writeInboxAssignments(map);
  return map;
}

export function clearInboxAssignments(taskIds: string[]): InboxAssignmentMap {
  const map = readInboxAssignments();
  for (const id of taskIds) delete map[id];
  writeInboxAssignments(map);
  return map;
}

export function countAssignedTo(
  map: InboxAssignmentMap,
  assigneeId: string,
  taskIds?: string[],
): number {
  const ids = taskIds ?? Object.keys(map);
  let n = 0;
  for (const id of ids) {
    if (map[id]?.assigneeId === assigneeId) n += 1;
  }
  return n;
}
