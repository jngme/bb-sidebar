import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ReclaimSummary } from "./reclaim";

/** Durable intent, separate from message queues (which would start a turn). */
export function registerDeferredSettle(
  bb: BbPluginApi,
  settle: (threadId: string, beforeCommit: () => Promise<void>) => Promise<ReclaimSummary>,
) {
  const db = bb.storage.database();
  const pending = (threadId: string) => db.prepare(
    "SELECT token FROM deferred_settle WHERE thread_id = ?",
  ).get(threadId) as { token: string } | undefined;
  const cancel = (threadId: string) => db.prepare(
    "DELETE FROM deferred_settle WHERE thread_id = ?",
  ).run(threadId).changes > 0;
  let disposed = false;
  const inFlight = new Set<Promise<void>>();
  const checking = new Set<string>();

  const ready = async (threadId: string) => {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.deletedAt !== null || thread.archivedAt !== null || thread.status === "error") {
      cancel(threadId);
      return false;
    }
    if (thread.status !== "idle" || thread.queuedMessageCount > 0 || thread.activeBackgroundAgentCount > 0) return false;
    // The list projection includes background commands and pending interactions;
    // threads.get alone does not. Missing data never permits cleanup.
    for (let offset = 0; ; offset += 500) {
      const page = await bb.sdk.threads.list({ projectId: thread.projectId, includeHidden: true, limit: 500, offset });
      const row = page.find((candidate) => candidate.id === threadId);
      if (row) return row.status === "idle" && row.runtime.displayStatus === "idle" && row.queuedWork === "none" &&
        !row.hasPendingInteraction && Object.values(row.activity).every((count) => count === 0);
      if (page.length < 500) return false;
    }
  };

  const check = async (threadId: string) => {
    if (disposed || checking.has(threadId)) return;
    const request = pending(threadId);
    if (!request) return;
    checking.add(threadId);
    try {
      if (!await ready(threadId) || disposed || pending(threadId)?.token !== request.token) return;
      await settle(threadId, async () => {
        // Recheck after native unpin's await, then consume intent synchronously
        // with the shelf commit. Cancellation wins until this point.
        if (!await ready(threadId) || disposed || pending(threadId)?.token !== request.token) {
          throw new Error("Deferred settle cancelled or thread is no longer idle");
        }
        cancel(threadId);
      });
      bb.log.info(`Deferred settle completed for ${threadId}`);
    } catch (error) {
      bb.log.warn(`Deferred settle for ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      checking.delete(threadId);
    }
  };
  const startCheck = (threadId: string) => {
    const task = check(threadId);
    inFlight.add(task);
    void task.finally(() => inFlight.delete(task));
    return task;
  };
  bb.events.on("thread.idle", ({ thread }) => startCheck(thread.id));
  for (const event of ["thread.active", "thread.failed", "thread.archived", "thread.deleted", "interaction.pending"] as const) {
    bb.events.on(event, ({ thread }) => { cancel(thread.id); });
  }
  bb.events.on("message.queued", ({ entry }) => { cancel(entry.threadId); });
  // Runs before admission, including immediate messages that never queue.
  bb.experimental_hooks.on("message.dispatch", (context) => {
    cancel(context.thread.id);
    return { action: "proceed" };
  });
  bb.background.schedule("deferred-settle", "* * * * *", async () => {
    const rows = db.prepare("SELECT thread_id FROM deferred_settle").all() as { thread_id: string }[];
    for (const row of rows) await startCheck(row.thread_id);
  });
  bb.onDispose(async () => {
    disposed = true;
    await Promise.allSettled([...inFlight]);
  });
  return {
    request(threadId: string) {
      db.prepare("INSERT INTO deferred_settle(thread_id, token) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET token = excluded.token")
        .run(threadId, randomUUID());
      // The minute sweep also handles requests made after the idle event.
    },
    cancel,
    isPending: (threadId: string) => pending(threadId) !== undefined,
  };
}
