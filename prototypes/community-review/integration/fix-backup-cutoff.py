# -*- coding: utf-8 -*-
from pathlib import Path
target = Path(__file__).resolve().parent.parent / 'index.html'
text = target.read_text(encoding='utf-8')
changes = [
 ('const d=validateImport(JSON.parse(await file.text()))', 'const d=prepareImport(JSON.parse(await file.text()))'),
 ('导入活动段全部冻结，分享全部恢复私人；其他类别保留。', '活动时间截至备份导出时刻，不会自动继续计时。分享全部恢复私人；其他类别保留。'),
 ('先备份当前数据再确认。</p><div class="row actions">', '先备份当前数据再确认。</p>${d.events?.some(e=>e.importRecovery?.cutoff===null)?\'<p class="error">部分开放区间缺少导出时刻，无法确定用时；仅保留区间起点，不将未知时长计入记录。</p>\':\'\'}<div class="row actions">'),
 ('if(d.events){d.events.forEach(e=>freeze(e,Date.now()));d.activeId=null}', 'if(d.events)validateEventTimeline(d.events,d.activeId);'),
 ('for(const e of snapshot.events)freeze(e,Date.now());list.push', 'for(const e of snapshot.events)freeze(e,Date.now());snapshot.activeId=null;list.push'),
 ('<h3>活动时间段</h3><div class="list">', '<h3>活动时间段</h3>${e.importRecovery?.cutoff===null?`<p class="small muted">备份缺少导出时刻，开放区间未计入用时。原起点：${dt(e.importRecovery.openStart)}。</p>`:\'\'}<div class="list">'),
]
for before, after in changes:
    if text.count(before) != 1:
        raise SystemExit('Expected one match: ' + before[:60])
    text = text.replace(before, after)
with target.open('w', encoding='utf-8', newline='\n') as output:
    output.write(text)
print('Updated backup cutoff, review, archive and detail paths.')
