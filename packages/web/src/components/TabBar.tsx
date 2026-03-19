/**
 * Bottom Tab Bar — mobile-friendly navigation between main app sections.
 *
 * Uses TabContext instead of URL navigation so both views stay mounted
 * and preserve their state (scroll position, form input, etc.).
 *
 * Includes a theme cycle shortcut button.
 */

import { IconChat } from "./Icons";
import { useTab, type TabId } from "../hooks/useTab";
import { useAppearance, type AppearanceSettings } from "../hooks/useAppearance";
import { haptic } from "../utils/haptics";

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

const THEME_ORDER: AppearanceSettings["theme"][] = ["dark", "midnight", "warm"];
const THEME_ICONS: Record<AppearanceSettings["theme"], string> = {
  dark: "🌙",
  midnight: "🌑",
  warm: "☀️",
};

export function TabBar() {
  const { activeTab, setActiveTab } = useTab();
  const { settings, update } = useAppearance();

  const cycleTheme = () => {
    const idx = THEME_ORDER.indexOf(settings.theme);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    update("theme", next);
    haptic("light");
  };

  return (
    <nav className="tab-bar">
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            className={`tab-bar-item ${active ? "active" : ""}`}
            onClick={() => {
              setActiveTab(tab.id);
              haptic("light");
            }}
          >
            <span className="tab-bar-icon">{tab.icon}</span>
            <span className="tab-bar-label">{tab.label}</span>
          </button>
        );
      })}
      <button
        className="tab-bar-item"
        onClick={cycleTheme}
        title={`Theme: ${settings.theme}`}
      >
        <span className="tab-bar-icon" style={{ fontSize: 18 }}>
          {THEME_ICONS[settings.theme]}
        </span>
        <span className="tab-bar-label">Theme</span>
      </button>
    </nav>
  );
}
