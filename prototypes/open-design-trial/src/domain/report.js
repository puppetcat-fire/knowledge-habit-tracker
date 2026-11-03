// 战报：只组织真实操作产生的数据，不编造得分、等级、排名、连胜或奖励。
import { stepsOf } from './events.js';
import { duration } from './records.js';

export function buildReport(state, event, now = Date.now()) {
  if (!event) return null;
  const steps = stepsOf(state, event.name);
  const stepRows = steps.map((step) => ({
    id: step.id,
    text: step.text,
    done: event.stepDone.includes(step.id)
  }));
  const segments = event.segments.map((segment) => ({
    startedAt: segment.startedAt,
    endedAt: segment.endedAt ?? now
  }));
  return {
    id: event.id,
    name: event.name,
    startedAt: event.startedAt,
    endedAt: event.endedAt ?? now,
    durationMs: duration(event, now),
    segmentCount: segments.length,
    segments,
    steps: stepRows,
    notes: event.notes.map((note) => ({ id: note.id, text: note.text, at: note.at })),
    knowledge: event.knowledge || null,
    habitId: event.habitId || null
  };
}
