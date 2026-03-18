/**
 * useAppearance — real-time CSS variable overrides persisted in localStorage.
 *
 * Provides a React context so any component can read/write appearance settings.
 * On mount it reads `porta:appearance` from localStorage and injects overrides
 * onto `document.documentElement.style`, so CSS picks them up immediately.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

// ── Types ──

export interface AppearanceSettings {
  /** Theme preset key */
  theme: "dark" | "midnight" | "warm";
  /** Accent color as "R G B" triplet string */
  accentColor: string;
  /** Swiper chip width in px */
  swiperChipWidth: number;
  /** Swiper chip height in px */
  swiperChipHeight: number;
  /** Max visible swiper chips */
  swiperMaxVisible: number;
  /** Whether to show the swiper */
  swiperVisible: boolean;
  /** Whether to show all projects in swiper (vs current only) */
  swiperAllProjects: boolean;
  /** Active chip glow spread in px (0 = off) */
  swiperActiveGlow: number;
  /** Active chip border opacity (0.2 – 1.0) */
  swiperActiveBorderOpacity: number;
  /** Per-project color overrides: project name → hex color */
  projectColorOverrides: Record<string, string>;
  /** Message body font size in px */
  messageFontSize: number;
  /** Code font size in px */
  codeFontSize: number;
  /** Global border radius in px */
  borderRadius: number;
  /** UI density */
  density: "compact" | "normal" | "spacious";
}

// ── Defaults ──

export const DEFAULTS: AppearanceSettings = {
  theme: "dark",
  accentColor: "108 139 239",
  swiperChipWidth: 130,
  swiperChipHeight: 36,
  swiperMaxVisible: 8,
  swiperVisible: true,
  swiperAllProjects: false,
  swiperActiveGlow: 8,
  swiperActiveBorderOpacity: 0.6,
  projectColorOverrides: {},
  messageFontSize: 13.5,
  codeFontSize: 12,
  borderRadius: 10,
  density: "normal",
};

// ── Theme presets ──

interface ThemeVars {
  "--c-accent": string;
  "--bg-primary": string;
  "--bg-secondary": string;
  "--bg-tertiary": string;
  "--bg-surface": string;
  "--bg-hover": string;
  "--bg-active": string;
  "--border-subtle": string;
  "--border-default": string;
  "--text-primary": string;
  "--text-secondary": string;
  "--text-tertiary": string;
  "--text-accent": string;
  "--accent-hover": string;
}

const THEME_PRESETS: Record<AppearanceSettings["theme"], ThemeVars> = {
  dark: {
    "--c-accent": "108 139 239",
    "--bg-primary": "#0d0f13",
    "--bg-secondary": "#14171e",
    "--bg-tertiary": "#1a1e28",
    "--bg-surface": "#1e2230",
    "--bg-hover": "#252a38",
    "--bg-active": "#2d3348",
    "--border-subtle": "#2a2f3e",
    "--border-default": "#353b4e",
    "--text-primary": "#e8eaf0",
    "--text-secondary": "#9ba3b8",
    "--text-tertiary": "#6b7280",
    "--text-accent": "#8ba4f8",
    "--accent-hover": "#8ba4f8",
  },
  midnight: {
    "--c-accent": "99 120 255",
    "--bg-primary": "#08090d",
    "--bg-secondary": "#0e1017",
    "--bg-tertiary": "#13161f",
    "--bg-surface": "#181c28",
    "--bg-hover": "#1f2435",
    "--bg-active": "#272d42",
    "--border-subtle": "#1e2338",
    "--border-default": "#2a3050",
    "--text-primary": "#dfe2ec",
    "--text-secondary": "#8890a8",
    "--text-tertiary": "#5a6278",
    "--text-accent": "#7b93ff",
    "--accent-hover": "#7b93ff",
  },
  warm: {
    "--c-accent": "217 153 97",
    "--bg-primary": "#12100e",
    "--bg-secondary": "#1a1714",
    "--bg-tertiary": "#211d18",
    "--bg-surface": "#28231c",
    "--bg-hover": "#332c23",
    "--bg-active": "#3d342a",
    "--border-subtle": "#2e2820",
    "--border-default": "#3e3630",
    "--text-primary": "#ece5db",
    "--text-secondary": "#b0a699",
    "--text-tertiary": "#7a6f62",
    "--text-accent": "#e0a86a",
    "--accent-hover": "#e0a86a",
  },
};

// ── Density multipliers for padding ──

const DENSITY_MAP: Record<AppearanceSettings["density"], number> = {
  compact: 0.7,
  normal: 1.0,
  spacious: 1.3,
};

// ── Storage helpers ──

const STORAGE_KEY = "porta:appearance";

function loadSettings(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

function saveSettings(s: AppearanceSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

// ── Apply CSS vars to document ──

function applyToDOM(s: AppearanceSettings) {
  const el = document.documentElement.style;

  // Theme preset colors
  const preset = THEME_PRESETS[s.theme] ?? THEME_PRESETS.dark;
  for (const [key, value] of Object.entries(preset)) {
    el.setProperty(key, value);
  }

  // Accent override (on top of theme)
  el.setProperty("--c-accent", s.accentColor);
  // Derived accent vars
  const [r, g, b] = s.accentColor.split(" ").map(Number);
  el.setProperty("--accent", `rgb(${r}, ${g}, ${b})`);
  el.setProperty("--accent-hover", `rgb(${Math.min(r + 20, 255)}, ${Math.min(g + 20, 255)}, ${Math.min(b + 20, 255)})`);
  el.setProperty("--text-accent", `rgb(${Math.min(r + 30, 255)}, ${Math.min(g + 30, 255)}, ${Math.min(b + 30, 255)})`);
  el.setProperty("--border-focus", `rgb(${r}, ${g}, ${b})`);

  // Swiper
  el.setProperty("--swiper-chip-width", `${s.swiperChipWidth}px`);
  el.setProperty("--swiper-chip-height", `${s.swiperChipHeight}px`);
  el.setProperty("--swiper-max-visible", `${s.swiperMaxVisible}`);
  el.setProperty("--swiper-display", s.swiperVisible ? "block" : "none");
  el.setProperty("--swiper-active-glow", `${s.swiperActiveGlow}px`);
  el.setProperty("--swiper-active-border-opacity", `${s.swiperActiveBorderOpacity}`);

  // Text
  el.setProperty("--msg-font-size", `${s.messageFontSize}px`);
  el.setProperty("--code-font-size", `${s.codeFontSize}px`);

  // Layout
  const densityFactor = DENSITY_MAP[s.density] ?? 1;
  el.setProperty("--radius-sm", `${Math.round(s.borderRadius * 0.6)}px`);
  el.setProperty("--radius-md", `${s.borderRadius}px`);
  el.setProperty("--radius-lg", `${Math.round(s.borderRadius * 1.4)}px`);
  el.setProperty("--density-factor", `${densityFactor}`);
}

// ── Context ──

interface AppearanceContextValue {
  settings: AppearanceSettings;
  update: <K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]) => void;
  reset: () => void;
}

const AppearanceContext = createContext<AppearanceContextValue>({
  settings: DEFAULTS,
  update: () => {},
  reset: () => {},
});

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppearanceSettings>(loadSettings);

  // Apply on mount and whenever settings change
  useEffect(() => {
    applyToDOM(settings);
    saveSettings(settings);
  }, [settings]);

  const update = useCallback(
    <K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const reset = useCallback(() => {
    setSettings({ ...DEFAULTS });
  }, []);

  return (
    <AppearanceContext.Provider value={{ settings, update, reset }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  return useContext(AppearanceContext);
}
