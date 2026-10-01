/**
 * What parking a thread releases, and what it deliberately leaves alone.
 *
 * A manual settle means the thread is finished, so it cleans up everything:
 * the agent runtime, every terminal (forced, like bb's archive), and the
 * processes on ports the thread owns.
 *
 * Park, snooze and automatic settling are gentler. They release the agent
 * runtime, which bb keeps warm long after the last turn and which costs
 * hundreds of megabytes per thread. Terminals are the awkward case: they
 * outlive their thread until the daemon restarts, but bb refuses to close one
 * anybody has typed into unless the caller forces it, and forcing would kill a
 * dev server the user is coming back to. So these close only the terminals
 * nobody touched, and report the rest instead of deciding for them.
 */

/** "untouched" closes terminals nobody typed in; "all" closes every one. */
export type TerminalReclaimScope = "untouched" | "all";

export interface ReclaimTerminal {
  id: string;
  lastUserInputAt: number | null;
  status: "disconnected" | "exited" | "running" | "starting";
}

export interface TerminalReclaimPlan {
  /** Terminals settling may close, in the order they were listed. */
  close: string[];
  /** Live terminals settling refuses to touch, because someone typed in them. */
  keep: number;
}

export interface ReclaimSummary {
  closedTerminals: number;
  keptTerminals: number;
  stoppedRuntime: boolean;
  /** Ports whose owning process was asked to stop. */
  stoppedPorts: number;
}

export const EMPTY_RECLAIM: ReclaimSummary = {
  closedTerminals: 0,
  keptTerminals: 0,
  stoppedRuntime: false,
  stoppedPorts: 0,
};

/**
 * A disconnected terminal's process may or may not still exist on the far side
 * of a dead daemon, so it is not counted as running. Claiming a number the
 * user cannot verify is worse than leaving it out of the reminder.
 */
function isLive(terminal: ReclaimTerminal): boolean {
  return terminal.status === "running" || terminal.status === "starting";
}

export function planTerminalReclaim(
  terminals: readonly ReclaimTerminal[],
  scope: TerminalReclaimScope = "untouched",
): TerminalReclaimPlan {
  const live = terminals.filter(isLive);
  const close = live
    .filter(
      (terminal) => scope === "all" || terminal.lastUserInputAt === null,
    )
    .map((terminal) => terminal.id);
  return { close, keep: live.length - close.length };
}

function terminalCount(count: number): string {
  return `${count} ${count === 1 ? "terminal" : "terminals"}`;
}

/**
 * The one-line reminder shown after settling. Undefined when there is nothing
 * to say, so the toast stays a bare confirmation rather than an empty clause.
 */
export function describeReclaim(summary: ReclaimSummary): string | undefined {
  const parts: string[] = [];
  if (summary.stoppedRuntime) parts.push("Agent session stopped");
  if (summary.closedTerminals > 0) {
    parts.push(`closed ${terminalCount(summary.closedTerminals)}`);
  }
  if (summary.stoppedPorts > 0) {
    parts.push(
      `stopped processes on ${summary.stoppedPorts} ${summary.stoppedPorts === 1 ? "port" : "ports"}`,
    );
  }
  if (summary.keptTerminals > 0) {
    parts.push(`${terminalCount(summary.keptTerminals)} left running`);
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}
