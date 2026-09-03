/**
 * 日界与时区。
 *
 * 规则（ADR-014）：
 * - 所有时间戳按 UTC 存储。
 * - 「属于哪一天」由本地日界决定，默认本地时间 04:00。
 * - 归属判定用半开区间 [start, end)。
 * - 换时区只影响 local_date 的折算，不改动原始时间戳。
 *
 * 半开区间与 UTC 存储的做法借鉴 temosy/devlog（MIT），见 THIRD_PARTY_NOTICES.md。
 */

export const DEFAULT_CUTOFF_HOUR = 4;

/** @param {Date} date @returns {string} 本地时区的 YYYY-MM-DD */
export function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 某个本地日期对应的 UTC 半开区间。
 * @param {string} localDate YYYY-MM-DD
 * @param {number} cutoffHour 本地日界小时，0-23
 * @returns {{localDate:string,startUtc:string,endUtc:string}}
 */
export function dayRange(localDate, cutoffHour = DEFAULT_CUTOFF_HOUR) {
  const [y, m, d] = localDate.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`日期格式应为 YYYY-MM-DD，收到：${localDate}`);
  // 用本地时间构造再转 UTC，夏令时由 Date 自行处理；d+1 的月末溢出也由 Date 处理。
  const start = new Date(y, m - 1, d, cutoffHour, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, cutoffHour, 0, 0, 0);
  return { localDate, startUtc: start.toISOString(), endUtc: end.toISOString() };
}

/**
 * 某个瞬间属于哪个本地日期（按日界折算）。
 * @param {Date|string|number} instant
 * @param {number} cutoffHour
 * @returns {string|null} YYYY-MM-DD，无法解析时返回 null
 */
export function localDateOf(instant, cutoffHour = DEFAULT_CUTOFF_HOUR) {
  const t = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(t.getTime())) return null;
  return ymd(new Date(t.getTime() - cutoffHour * 3600_000));
}

/** 今天（按日界）。@param {number} cutoffHour @returns {string} */
export function todayLocalDate(cutoffHour = DEFAULT_CUTOFF_HOUR) {
  return localDateOf(new Date(), cutoffHour);
}

/**
 * 半开区间判定：start <= t < end。
 * @param {Date|string|number} instant
 * @param {string} startUtc
 * @param {string} endUtc
 */
export function inRange(instant, startUtc, endUtc) {
  const t = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(t.getTime())) return false;
  return t.getTime() >= Date.parse(startUtc) && t.getTime() < Date.parse(endUtc);
}

/**
 * 以 localDate 为最后一天的 N 天区间（默认 7 天），用于周报。
 * @param {string} localDate
 * @param {number} days
 * @param {number} cutoffHour
 */
export function multiDayRange(localDate, days = 7, cutoffHour = DEFAULT_CUTOFF_HOUR) {
  const [y, m, d] = localDate.split('-').map(Number);
  const first = ymd(new Date(y, m - 1, d - (days - 1)));
  const a = dayRange(first, cutoffHour);
  const b = dayRange(localDate, cutoffHour);
  return { localDate, startUtc: a.startUtc, endUtc: b.endUtc, days };
}

/** 把区间拆成逐日的 localDate 列表。 */
export function datesIn(range, cutoffHour = DEFAULT_CUTOFF_HOUR) {
  const out = [];
  let cursor = Date.parse(range.startUtc);
  const end = Date.parse(range.endUtc);
  while (cursor < end) {
    out.push(localDateOf(new Date(cursor + 3600_000), cutoffHour));
    cursor += 86_400_000;
  }
  return [...new Set(out)];
}

