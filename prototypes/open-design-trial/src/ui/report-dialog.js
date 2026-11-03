// 结束战报：游戏化的完成感来自真实数据，不编造得分、等级、排名、连胜或奖励。
import { el, button, fmtDate, fmtDuration, fmtTimeSec } from './dom.js';
import { buildReport } from '../domain/report.js';
import { node as findNode, methodOf } from '../domain/knowledge.js';
import { draftFor } from '../domain/knowledge.js';

export function openReport(state, event, actions) {
  const report = buildReport(state, event);
  if (!report) return null;
  const knowledgeNode = report.knowledge ? findNode(state, report.knowledge.nodeId) : null;
  const method = report.knowledge && report.knowledge.methodId ? methodOf(state, report.knowledge.methodId) : null;
  const draft = draftFor(state, report.id);

  const dialog = el('dialog', { class: 'report-dialog', attrs: { 'aria-label': '行动战报' } });
  const inner = el('div', { class: 'report-inner' });

  inner.append(el('p', { class: 'report-kicker', text: '行动战报' }));
  inner.append(el('h2', { class: 'report-title', text: report.name }));
  inner.append(el('p', {
    class: 'hint',
    text: `${fmtDate(report.startedAt)} ${fmtTimeSec(report.startedAt)} 开始，${fmtTimeSec(report.endedAt)} 结束`
  }));

  inner.append(el('div', { class: 'report-metrics' }, [
    metric('实际累计', fmtDuration(report.durationMs)),
    metric('活动时间段', `${report.segmentCount} 段`),
    metric('单次笔记', `${report.notes.length} 条`)
  ]));

  if (report.segments.length) {
    const section = el('div', { class: 'report-section' }, [el('h3', { text: '时间段' })]);
    const list = el('ul');
    for (const segment of report.segments) {
      list.append(el('li', { text: `${fmtTimeSec(segment.startedAt)} – ${fmtTimeSec(segment.endedAt)}（${fmtDuration(segment.endedAt - segment.startedAt)}）` }));
    }
    section.append(list);
    inner.append(section);
  }

  if (report.steps.length) {
    const done = report.steps.filter((step) => step.done).length;
    const list = el('ul');
    for (const step of report.steps) {
      list.append(el('li', { text: `${step.done ? '✓' : '○'} ${step.text}` }));
    }
    inner.append(el('details', { class: 'report-fold' }, [
      el('summary', { text: `步骤（${done} / ${report.steps.length} 完成）` }),
      list
    ]));
  }

  if (report.notes.length) {
    const notes = report.notes.map((note) => el('p', { class: 'report-note', text: note.text }));
    inner.append(el('details', { class: 'report-fold' }, [
      el('summary', { text: `本次笔记（${report.notes.length} 条）` }),
      el('div', { class: 'stack tight' }, notes)
    ]));
  } else {
    inner.append(el('details', { class: 'report-fold' }, [
      el('summary', { text: '本次笔记（0 条）' }),
      el('p', { class: 'hint', text: '这次没有留下笔记。没有填写的内容不会补造。' })
    ]));
  }

  if (knowledgeNode) {
    const section = el('div', { class: 'report-section' }, [el('h3', { text: '关联知识' })]);
    section.append(el('p', { class: 'practice-link', text: `${knowledgeNode.name}${method ? ` · ${method.title} v${method.version}` : ''}` }));
    if (draft) {
      section.append(button('去确认点亮', {
        class: 'btn sm gold',
        on: {
          click: () => {
            dialog.close();
            actions.navigate('node-detail', { nodeId: knowledgeNode.id });
          }
        }
      }));
    } else {
      section.append(el('p', { class: 'hint', text: '点亮需要你自己确认，计时结束不会代替你确认。' }));
    }
    inner.append(section);
  }

  inner.append(el('div', { class: 'report-actions' }, [
    button('查看事件记录', {
      class: 'btn',
      on: {
        click: () => {
          dialog.close();
          actions.navigate('event-detail', { eventId: report.id });
        }
      }
    }),
    button('完成', { class: 'btn primary', on: { click: () => dialog.close() } })
  ]));

  dialog.append(inner);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

function metric(label, value) {
  return el('div', { class: 'report-metric' }, [
    el('div', { class: 'm-label', text: label }),
    el('div', { class: 'm-num', text: value })
  ]);
}
