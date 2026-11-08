# -*- coding: utf-8 -*-
from pathlib import Path
p=Path(__file__).resolve().parent.parent/'index.html'
s=p.read_text(encoding='utf-8')
s=s.replace("x.parentId||x.parentOrigin?'", "x.parentId||x.parentOrigin||x.parentMissing?'")
s=s.replace("e.parentId||e.parentOrigin?'", "e.parentId||e.parentOrigin||e.parentMissing?'")
before='<h3>活动时间段</h3>'
assert s.count(before)==1
s=s.replace(before,before+'${e.parentMissing?`<p class="small muted">原来源记录暂不可用。来源 ID：${esc(e.parentMissing.id)}；未推断来源名称或删除原因。</p>`:\'\'}')
lines=s.splitlines()
for i,line in enumerate(lines):
    if line.startswith('function accountPage(){'):
        assert line.endswith('`}')
        lines[i]=line[:-1]+'+missingParentPanel()}'
        break
else:raise SystemExit('Missing account page')
s='\n'.join(lines)+'\n'
before="else if(a==='confirm-delete'){"
assert s.count(before)==1
s=s.replace(before,"else if(a==='review-missing-parent')reviewMissingParents();\n else if(a==='confirm-missing-parent')markMissingParents();\n "+before)
with p.open('w',encoding='utf-8',newline='\n') as out:out.write(s)
print('Updated missing-source review entry, actions and presentation.')
