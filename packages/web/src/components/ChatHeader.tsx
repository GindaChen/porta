import { IconMenu, IconFolder } from "./Icons";
import { useAppearance } from "../hooks/useAppearance";

interface Props {
  title: string;
  projectName?: string;
  onMenuToggle?: () => void;
}

export function ChatHeader({ title, projectName, onMenuToggle }: Props) {
  const { settings, update } = useAppearance();

  return (
    <div className="main-header">
      {onMenuToggle && (
        <button
          className="mobile-menu-btn"
          onClick={onMenuToggle}
          title="Open menu"
        >
          <IconMenu size={18} />
        </button>
      )}
      <span
        className="main-header-title"
        onClick={() => {
          document
            .querySelector(".chat-area")
            ?.scrollTo({ top: 0, behavior: "smooth" });
        }}
      >
        {title}
      </span>
      <div className="main-header-actions">
        <button
          className="header-refresh-btn"
          onClick={() => update("mutePush", !settings.mutePush)}
          title={settings.mutePush ? "Unmute notifications" : "Mute notifications"}
          style={{ opacity: settings.mutePush ? 0.4 : 1 }}
        >
          {settings.mutePush ? "🔕" : "🔔"}
        </button>
        <button
          className="header-refresh-btn"
          onClick={() => window.location.reload()}
          title="Reload app"
        >
          ⟳
        </button>
        {projectName && (
          <span className="main-header-project">
            <IconFolder size={11} /> {projectName}
          </span>
        )}
      </div>
    </div>
  );
}
