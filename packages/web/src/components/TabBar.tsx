/**
 * Bottom Tab Bar — mobile-friendly navigation between main app sections.
 *
 * Uses TabContext instead of URL navigation so both views stay mounted
 * and preserve their state (scroll position, form input, etc.).
 */

import { IconChat } from "./Icons";
import { useTab, type TabId } from "../hooks/useTab";

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  {
    id: "chat",
    label: "Chat",
    icon: <IconChat size={20} />,
  },
  {
    id: "settings",
    label: "Settings",
    icon: <span style={{ fontSize: 20, lineHeight: 1 }}>⚙</span>,
  },
];

export function TabBar() {
  const { activeTab, setActiveTab } = useTab();

  return (
    <nav className="tab-bar">
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            className={`tab-bar-item ${active ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-bar-icon">{tab.icon}</span>
            <span className="tab-bar-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
