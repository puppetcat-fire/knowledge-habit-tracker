# -*- coding: utf-8 -*-
from pathlib import Path
target=Path(__file__).resolve().parent.parent/'index.html'
source=target.read_text(encoding='utf-8')
for before,after in [
 ("${x.parentId?' · 子任务':''}","${x.parentId||x.parentOrigin?' · 子任务':''}"),
 ("${e.parentId?'子任务':", "${e.parentId||e.parentOrigin?'子任务':"),
 ('<h3>活动时间段</h3>', '<h3>活动时间段</h3>${e.parentOrigin?`<p class="small muted">父记录「${esc(e.parentOrigin.name)}」已删除；这次子任务独立保留。</p>`:\'\'}'),
 ('将删除该事件及其笔记、关联点亮，不影响其他事件。', '将删除该事件及其笔记、关联点亮。子事件和计时保留，只留下父记录名称、ID和来源步骤，标明父记录已删除。'),
 ("else if(a==='confirm-delete'){S.events=S.events.filter(e=>e.id!==id);S.lights=S.lights.filter(l=>l.eventId!==id);", "else if(a==='confirm-delete'){if(!deleteEventRecord(id)){toast('只能删除已结束的历史记录。');return}"),
]:
 if source.count(before)!=1:raise SystemExit('Expected one match: '+before)
 source=source.replace(before,after)
with target.open('w',encoding='utf-8',newline='\n') as output:output.write(source)
print('Updated deletion confirmation and child origin presentation.')
