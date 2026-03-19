/**
 * Haptic feedback utility.
 *
 * Calls navigator.vibrate() with type-appropriate durations.
 * Silently no-ops on devices that don't support it (e.g. iOS Safari).
 */

type HapticType = "light" | "medium" | "heavy";

const DURATIONS: Record<HapticType, number | number[]> = {
  light: 10,
  medium: 25,
  heavy: [30, 10, 30],
};

export function haptic(type: HapticType = "light"): void {
  try {
    navigator?.vibrate?.(DURATIONS[type]);
  } catch {
    // Not supported
  }
}
