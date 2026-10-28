import type { NotificationStatus } from "./types.js";

const ALLOWED: Record<NotificationStatus, NotificationStatus[]> = {
  pending: ["queued", "dead"],
  queued: ["processing", "dead"],
  processing: ["submitted", "retrying", "dead"],
  submitted: ["delivered", "dead"],
  retrying: ["queued", "dead"],
  delivered: [],
  dead: []
};

export function canTransition(from: NotificationStatus, to: NotificationStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: NotificationStatus, to: NotificationStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal_state_transition:${from}->${to}`);
  }
}

export const TERMINAL_STATUSES: NotificationStatus[] = ["delivered", "dead"];

export function isTerminal(status: NotificationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Workers may only advance from these claimable states.
 * A stale worker cannot move delivered/dead backward.
 */
export function isClaimable(status: NotificationStatus): boolean {
  return status === "queued" || status === "retrying" || status === "pending";
}
