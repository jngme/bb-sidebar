// `bb sidebar settle|unsettle <threadId...>`: the sidebar's settle and restore
// actions for agents and automations, which cannot click the sidebar.
import type { BbPluginApi, PluginCliResult } from "@get-bb/plugin-sdk";
import type { ReclaimSummary } from "./reclaim";
import { runThreadTasks } from "./thread-tasks";

const SETTLE_CLI_MAX_THREADS = 50;
const THREAD_ID_PATTERN = /^thr_[A-Za-z0-9_-]{1,64}$/;

const USAGE = {
  settle: "bb sidebar settle <threadId...>",
  unsettle: "bb sidebar unsettle <threadId...>",
  "cancel-settle": "bb sidebar cancel-settle <threadId...>",
  "settle-status": "bb sidebar settle-status <threadId...>",
} as const;

type Action = keyof typeof USAGE;

const HELP = `Usage:
  ${USAGE.settle}
  bb sidebar settle --when-idle <threadId...>
  ${USAGE.unsettle}
  ${USAGE["cancel-settle"]}
  ${USAGE["settle-status"]}

settle    Move threads to the Settled shelf, as the sidebar's Settle action
          does. Refuses a thread that is still working.
unsettle  Return settled threads to the inbox, as the sidebar's Restore
          action does. A thread that is not settled is left alone.

--when-idle records a durable request; settle runs after the turn finishes.
New messages, failed turns, or pending interactions cancel that request.
cancel-settle withdraws a pending request without stopping the thread.
settle-status reports whether a request is pending.

Takes 1 to ${SETTLE_CLI_MAX_THREADS} thread ids, such as thr_abc123.
`;

export interface SettleCliActions {
  request(threadId: string): void;
  cancel(threadId: string): boolean;
  isPending(threadId: string): boolean;
  isSettled(threadId: string): boolean;
  settle(threadId: string): Promise<ReclaimSummary>;
  unsettle(threadId: string): void;
}

type Thread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;

/** The same live work the sidebar refuses to settle. */
function isWorking(thread: Thread): boolean {
  return (
    thread.status === "active" ||
    thread.status === "pending" ||
    thread.status === "starting" ||
    thread.status === "stopping" ||
    thread.activeBackgroundAgentCount > 0 ||
    thread.queuedMessageCount > 0
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function describeReclaim(reclaim: ReclaimSummary): string {
  const parts: string[] = [];
  if (reclaim.stoppedRuntime) parts.push("stopped runtime");
  if (reclaim.closedTerminals > 0) {
    parts.push(`closed ${plural(reclaim.closedTerminals, "terminal")}`);
  }
  if (reclaim.keptTerminals > 0) {
    parts.push(`kept ${plural(reclaim.keptTerminals, "terminal")} in use`);
  }
  if (reclaim.stoppedPorts > 0) {
    parts.push(`stopped processes on ${plural(reclaim.stoppedPorts, "port")}`);
  }
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

function usageError(message: string): PluginCliResult {
  return { exitCode: 2, stderr: `${message}\n\n${HELP}` };
}

/** Parse argv into an action and distinct thread ids, or a usage error. */
function parseArgs(
  argv: readonly string[],
):
  | { kind: "help" }
  | { kind: "run"; action: Action; whenIdle: boolean; threadIds: string[] }
  | { kind: "error"; result: PluginCliResult } {
  const [command, ...rest] = argv;
  if (
    command === undefined ||
    command === "help" ||
    argv.includes("--help") ||
    argv.includes("-h")
  ) {
    return { kind: "help" };
  }
  if (command !== "settle" && command !== "unsettle" && command !== "cancel-settle" && command !== "settle-status") {
    return {
      kind: "error",
      result: usageError(`Unknown command: ${command}`),
    };
  }
  const whenIdle = command === "settle" && rest.includes("--when-idle");
  const args = whenIdle ? rest.filter((arg) => arg !== "--when-idle") : rest;
  const option = args.find((arg) => arg.startsWith("-"));
  if (option !== undefined) {
    return {
      kind: "error",
      result: usageError(`Unknown option: ${option}`),
    };
  }
  const threadIds = [...new Set(args)];
  if (threadIds.length === 0) {
    return {
      kind: "error",
      result: usageError(`Missing thread id. Usage: ${USAGE[command]}`),
    };
  }
  if (threadIds.length > SETTLE_CLI_MAX_THREADS) {
    return {
      kind: "error",
      result: usageError(
        `Too many thread ids: ${threadIds.length}. Pass at most ${SETTLE_CLI_MAX_THREADS} per call.`,
      ),
    };
  }
  const invalid = threadIds.filter((id) => !THREAD_ID_PATTERN.test(id));
  if (invalid.length > 0) {
    return {
      kind: "error",
      result: usageError(
        `Invalid thread id: ${invalid.map((id) => JSON.stringify(id.slice(0, 80))).join(", ")}. Expected an id like thr_abc123.`,
      ),
    };
  }
  return { kind: "run", action: command, whenIdle, threadIds };
}

export function registerSettleCli(
  bb: BbPluginApi,
  actions: SettleCliActions,
): void {
  const existingThread = async (threadId: string) => {
    let thread: Thread;
    try {
      thread = await bb.sdk.threads.get({ threadId });
    } catch (error) {
      // Anything but a missing thread, such as an unreachable server, keeps
      // its own message so it is not mistaken for a bad id.
      if (error instanceof Error && /not found/i.test(error.message)) {
        throw new Error("unknown thread");
      }
      throw error;
    }
    if (thread.deletedAt !== null) throw new Error("unknown thread");
    return thread;
  };

  const run = async (
    action: Action,
    threadIds: string[],
    whenIdle: boolean,
  ): Promise<PluginCliResult> => {
    const lines = new Map<string, string>();
    const { failures } = await runThreadTasks(threadIds, async (threadId) => {
      const thread = await existingThread(threadId);
      if (action === "cancel-settle") {
        lines.set(threadId, actions.cancel(threadId) ? `cancelled pending settle for ${threadId}` : `${threadId} has no pending settle; left unchanged`);
      } else if (action === "settle-status") {
        lines.set(threadId, actions.isPending(threadId) ? `${threadId}: settle pending` : `${threadId}: no pending settle`);
      } else if (action === "settle" && whenIdle) {
        if (thread.archivedAt !== null || thread.status === "error") throw new Error("cannot defer settle for an archived or failed thread");
        actions.request(threadId);
        lines.set(threadId, `settle pending for ${threadId}; cancel with bb sidebar cancel-settle ${threadId}`);
      } else if (action === "settle") {
        if (isWorking(thread)) {
          throw new Error("still working; settle it once it is idle");
        }
        const reclaim = await actions.settle(threadId);
        lines.set(threadId, `settled ${threadId}${describeReclaim(reclaim)}`);
      } else if (actions.isSettled(threadId)) {
        actions.unsettle(threadId);
        lines.set(threadId, `unsettled ${threadId}`);
      } else {
        actions.cancel(threadId);
        lines.set(threadId, `${threadId} was not settled; left unchanged`);
      }
    });
    const stdout = threadIds.flatMap((id) => lines.get(id) ?? []);
    const stderr = failures.map(
      ({ threadId, error }) =>
        `${action} failed for ${threadId}: ${error.slice(0, 500)}`,
    );
    return {
      exitCode: failures.length === 0 ? 0 : 1,
      stdout: stdout.length === 0 ? "" : `${stdout.join("\n")}\n`,
      stderr: stderr.length === 0 ? "" : `${stderr.join("\n")}\n`,
    };
  };

  bb.cli.register({
    name: "sidebar",
    summary: "Settle and unsettle threads on the BB Sidebar",
    commands: [
      { name: "cancel-settle", summary: "Cancel a pending settle", usage: USAGE["cancel-settle"] },
      { name: "settle-status", summary: "Check a pending settle", usage: USAGE["settle-status"] },
      {
        name: "settle",
        summary: "Move threads to the Settled shelf",
        usage: USAGE.settle,
      },
      {
        name: "unsettle",
        summary: "Return settled threads to the inbox",
        usage: USAGE.unsettle,
      },
    ],
    async run(argv) {
      const parsed = parseArgs(argv);
      if (parsed.kind === "help") return { exitCode: 0, stdout: HELP };
      if (parsed.kind === "error") return parsed.result;
      return run(parsed.action, parsed.threadIds, parsed.whenIdle);
    },
  });
}
