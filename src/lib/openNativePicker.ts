import type { MouseEvent } from "react";

/**
 * Opens the browser's own date/time picker when the field is tapped, not only
 * when its small icon is. On Android Chrome a tap on a date input just selects
 * the day segment — no keyboard, no calendar — so a manager who didn't spot
 * the icon had no way to change the date (Eric Levy, 2026-10-15).
 * showPicker throws where it isn't allowed (e.g. some embedded views); the
 * field then behaves exactly as before.
 */
export function openNativePicker(e: MouseEvent<HTMLInputElement>) {
  try {
    e.currentTarget.showPicker?.();
  } catch {
    // Not available here: the default behaviour stands.
  }
}
