/**
 * Tab Context — shared state for the bottom tab bar.
 *
 * Both ChatView and SettingsPage stay mounted; only visibility toggles.
 * This preserves scroll positions, form state, and other ephemeral UI state
 * when switching tabs.
 */

import { createContext, useContext, useState, useCallback } from "react";

export type TabId = "chat" | "settings";

interface TabContextValue {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

const TabContext = createContext<TabContextValue>({
  activeTab: "chat",
  setActiveTab: () => {},
});

export function useTab() {
  return useContext(TabContext);
}

export function TabProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTabRaw] = useState<TabId>("chat");

  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabRaw(tab);
  }, []);

  return (
    <TabContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </TabContext.Provider>
  );
}
