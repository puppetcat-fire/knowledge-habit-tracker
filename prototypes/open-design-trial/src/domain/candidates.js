// 候选事件：没有活动事件时展示「最可能的一件」，只排序、不显示概率数字。
import { finished } from './events.js';
import { currentHabit } from './habits.js';
import { suggestNext } from './knowledge.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * 可解释的启发式：近期频率（近 28 天次数）+ 时段吻合（与当前小时同一时段的历史数）+ 最近顺序。
 * 分数只用于排序，不在界面显示；数据不足时自然退化为习惯名 / 空。
 */
export function candidateList(state, now = Date.now(), limit = 6) {
  const events = finished(state);
  const hour = new Date(now).getHours();
  const scored = new Map();
  for (const event of events) {
    const key = (event.habitId || '') + '\u0000' + event.name;
    const entry = scored.get(key) || {
      name: event.name,
      habitId: event.habitId || null,
      count28: 0,
      hourMatch: 0,
      lastAt: 0,
      total: 0
    };
    entry.total += 1;
    entry.lastAt = Math.max(entry.lastAt, event.endedAt);
    if (event.endedAt >= now - 28 * DAY) entry.count28 += 1;
    const eventHour = new Date(event.endedAt).getHours();
    if (Math.abs(eventHour - hour) <= 1) entry.hourMatch += 1;
    scored.set(key, entry);
  }

  const items = [...scored.values()].map((entry) => {
    const ageDays = Math.max(0, (now - entry.lastAt) / DAY);
    const recency = Math.max(0, 1 - ageDays / 21); // 三周外基本不再加分
    const freq = Math.min(1, entry.count28 / 5);
    const sameHour = Math.min(1, entry.hourMatch / 3);
    const score = recency * 0.5 + freq * 0.3 + sameHour * 0.2;
    const hints = [];
    if (entry.hourMatch > 0 && entry.count28 > 0) hints.push('这个时段你常做');
    else if (entry.count28 > 0) hints.push('最近常做');
    else hints.push('很久没做');
    return { ...entry, score, hint: hints[0] };
  });

  items.sort((a, b) => b.score - a.score);

  const habit = currentHabit(state);
  const result = [];
  const seen = new Set();
  if (habit) {
    result.push({ name: habit.name, habitId: habit.id, hint: '当前习惯', source: 'habit', knowledge: null });
    seen.add((habit.id || '') + '\u0000' + habit.name);
  }
  const suggestion = suggestNext(state);
  if (suggestion) {
    result.push({
      name: suggestion.node.name,
      habitId: null,
      hint: suggestion.ready ? '知识路径里的下一步' : '知识路径里的下一步（有前置未点亮）',
      source: 'knowledge',
      knowledge: { treeId: 'trial-tree', nodeId: suggestion.node.id, methodId: suggestion.method.id, methodVersion: suggestion.method.version }
    });
    seen.add('\u0000' + suggestion.node.name);
  }
  for (const item of items) {
    if (result.length >= limit) break;
    const key = (item.habitId || '') + '\u0000' + item.name;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name: item.name, habitId: item.habitId, hint: item.hint, source: 'history', knowledge: null });
  }
  return result.slice(0, limit);
}
