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
```

- `settle` does what the sidebar's **Settle** action does: it unpins the
  thread, clears any snooze, moves it to the Settled shelf, then stops its
  idle agent session and closes terminals nobody typed into. Automatic settle
  rules do not undo a manual settle.
- `unsettle` does what the sidebar's **Restore** action does on the Settled
  shelf: it returns the thread to the inbox and keeps automatic settle from
  moving it back until the thread has new activity. A thread that is not
  settled is left unchanged.

Each command takes 1 to 50 thread ids, such as `thr_abc123`. Duplicates are
ignored. All ids are checked for format before anything changes; an id that
does not exist fails without stopping the others.

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
  thread cannot settle itself while its turn is running.
- Settling a thread does not archive it. Use `bb thread archive` for that.
