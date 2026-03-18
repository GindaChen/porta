/**
 * Bottom Tab Bar — mobile-friendly navigation between main app sections.
 */

import { useNavigate, useLocation } from "react-router-dom";
import { IconChat } from "./Icons";

interface Tab {
  id: string;
  label: string;
  icon: React.ReactNode;
  matchPath: (path: string) => boolean;
  navigateTo: string;
}

const TABS: Tab[] = [
  {
    id: "chat",
    label: "Chat",
    icon: <IconChat size={20} />,
    matchPath: (p) => !p.startsWith("/settings"),
    navigateTo: "/",
  },
  {
    id: "settings",
    label: "Settings",
    icon: <span style={{ fontSize: 20, lineHeight: 1 }}>⚙</span>,
    matchPath: (p) => p.startsWith("/settings"),
    navigateTo: "/settings",
  },
];

export function TabBar() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="tab-bar">
      {TABS.map((tab) => {
        const active = tab.matchPath(location.pathname);
        return (
          <button
            key={tab.id}
            className={`tab-bar-item ${active ? "active" : ""}`}
            onClick={() => {
              if (!active) navigate(tab.navigateTo);
            }}
          >
            <span className="tab-bar-icon">{tab.icon}</span>
            <span className="tab-bar-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
