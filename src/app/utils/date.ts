/**
 * All dates displayed in Beijing time (UTC+8).
 */

const BJ_TZ = "Asia/Shanghai";

/** 2026/02/23 14:30 */
export function formatBJDateTime(date: Date | number | string): string {
  const d = new Date(typeof date === "number" || typeof date === "string" ? date : date);
  return d.toLocaleString("zh-CN", { timeZone: BJ_TZ });
}

/** 2026/02/23 */
export function formatBJDate(date: Date | number | string): string {
  const d = new Date(typeof date === "number" || typeof date === "string" ? date : date);
  return d.toLocaleDateString("zh-CN", { timeZone: BJ_TZ });
}

/** 2026/02/23 14:30 (no seconds) — for end time preview */
export function formatBJEndTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    timeZone: BJ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
