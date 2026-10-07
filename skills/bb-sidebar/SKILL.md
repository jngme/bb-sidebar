---
name: bb-sidebar
description: Settle or unsettle threads on the BB Sidebar from the command line, for example to settle a child thread after its pull request merges.
---

# BB Sidebar

The BB Sidebar plugin keeps its own Settled shelf. Settling is not the same as
`bb thread archive`: a settled thread stays in the sidebar's Settled shelf,
and new activity brings it back to the inbox.

## Commands

```sh
bb sidebar settle <threadId...>
bb sidebar unsettle <threadId...>
bb sidebar settle --when-idle <threadId...>
bb sidebar cancel-settle <threadId...>
bb sidebar settle-status <threadId...>
```

- `settle` does what the sidebar's **Settle** action does: it unpins the
  thread, clears any snooze, moves it to the Settled shelf, then cleans up
  everything it left running: it stops the agent session, force-closes every
  terminal (including ones someone typed into), and stops the processes on
  ports the thread owns. Unsettling does not bring those back. Automatic
  settle rules do not undo a manual settle.
- `unsettle` does what the sidebar's **Restore** action does on the Settled
  shelf: it returns the thread to the inbox and keeps automatic settle from
  moving it back until the thread has new activity. A thread that is not
  settled is left unchanged.

Each command takes 1 to 50 thread ids, such as `thr_abc123`. Duplicates are
ignored. All ids are checked for format before anything changes; an id that
does not exist fails without stopping the others.

## Settle after finishing a turn

An agent can request its own settle with `bb sidebar settle --when-idle <threadId>`.
The plugin stores intent and performs the same full cleanup after the thread goes
idle and its queued messages, background work, and pending interactions are clear.
It handles the idle event immediately and checks missed events every minute.
An already idle thread is handled by the next minute check. The request survives
plugin reloads and server restarts. This runs on the server; it does not create a
script automation or need a project checkout on a scheduling host.

`bb sidebar cancel-settle <threadId>` cancels pending intent without stopping the
thread. `bb sidebar settle-status <threadId>` reports whether it is pending.
Any new message submission (including agent messages), new active turn, failed
turn, archive/delete, or pending interaction cancels intent. `unsettle` also
cancels it. Once the settle commits, cancellation cannot undo cleanup; use
`unsettle` to restore visibility. Killed processes are not restarted.

## Results

- Each change prints one line on stdout, such as `settled thr_abc123
  (stopped runtime, closed 1 terminal)`.
- Each failure prints one line on stderr, such as `settle failed for
  thr_abc123: unknown thread`.
- Exit code 0 means every thread succeeded, 1 means at least one failed, and
  2 means the arguments were invalid and nothing changed.

## Constraints

- `settle` refuses a thread that is still working: a running turn, queued
  messages, or background agents. Wait for the thread to go idle first. A
  thread can use `--when-idle` to request settling after its turn finishes.
- Settling a thread does not archive it. Use `bb thread archive` for that.
- A settled child thread leaves its parent's child list for the Settled
  shelf, and `unsettle` puts it back under its parent. Its parent link in bb
  does not change.
