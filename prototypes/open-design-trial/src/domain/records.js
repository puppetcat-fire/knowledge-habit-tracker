// 记录域：范围筛选、按天分组、汇总。全部按本地时区计算。
export const DAY = 24 * 60 * 60 * 1000;

export function startOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function endOfDay(timestamp) {
  return startOfDay(timestamp) + DAY - 1;
}

export function startOfMonth(timestamp) {
  const date = new Date(timestamp);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function dayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const RANGES = [
  { id: 'today', label: '今日' },
  { id: 'date', label: '指定日' },
  { id: 'week', label: '本周' },
  { id: 'month', label: '本月' },
  { id: 'all', label: '全部' }
];

/** 范围筛选：今日 / 指定日 / 本周（周一至今） / 本月 / 全部。 */
export function filterByRange(events, range, options = {}) {
  const now = options.now ?? Date.now();
  const day = options.date ? new Date(options.date + 'T00:00:00') : null;
  const dateStart = day && !Number.isNaN(day.getTime()) ? day.getTime() : startOfDay(now);
  const finished = events.filter((event) => event.endedAt !== null);
  switch (range) {
    case 'today':
      return finished.filter((event) => event.endedAt >= startOfDay(now) && event.endedAt <= endOfDay(now));
    case 'date':
      return finished.filter((event) => event.endedAt >= dateStart && event.endedAt <= dateStart + DAY - 1);
    case 'week': {
      const date = new Date(startOfDay(now));
      const offset = (date.getDay() + 6) % 7;
      const weekStart = date.getTime() - offset * DAY;
      return finished.filter((event) => event.endedAt >= weekStart && event.endedAt <= endOfDay(now));
    }
    case 'month':
      return finished.filter((event) => event.endedAt >= startOfMonth(now) && event.endedAt <= endOfDay(now));
    case 'all':
    default:
      return finished.slice();
  }
}

export function groupByDay(events) {
  const groups = new Map();
  const sorted = events.slice().sort((a, b) => b.endedAt - a.endedAt);
  for (const event of sorted) {
    const key = dayKey(event.endedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return [...groups.entries()].map(([key, items]) => ({ key, items }));
}

export function summarize(events, now = Date.now()) {
  const totalMs = events.reduce((total, event) => total + duration(event, now), 0);
  return { count: events.length, totalMs };
}

export function duration(event, now = Date.now()) {
  return event.segments.reduce((total, segment) => total + Math.max(0, (segment.endedAt ?? now) - segment.startedAt), 0);
}

export function dayLabel(key, now = Date.now()) {
  const today = dayKey(now);
  const yesterday = dayKey(now - DAY);
  if (key === today) return '今天';
  if (key === yesterday) return '昨天';
  const date = new Date(key + 'T00:00:00');
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
