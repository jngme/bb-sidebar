import { createContext, useContext } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/**
 * Which threads are settled, and how to settle one, for the child rows and
 * hover cards nested under a parent. Handed down by context because those
 * rows sit under cards, the header popup and hover cards alike.
 *
 * Without a provider nothing counts as settled and child rows offer no
 * Settle action, which is how the lists behaved before settling children.
 */
export interface SettledChildren {
  isSettled(thread: PluginSidebarThread): boolean;
  settle?: (thread: PluginSidebarThread) => void;
}

export const SettledChildrenContext = createContext<SettledChildren>({
  isSettled: () => false,
});

export function useSettledChildren(): SettledChildren {
  return useContext(SettledChildrenContext);
}
