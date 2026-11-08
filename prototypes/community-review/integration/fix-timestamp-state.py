# -*- coding: utf-8 -*-
from pathlib import Path
import re

target = Path(__file__).resolve().parent.parent / 'index.html'
source = target.read_text(encoding='utf-8')
source, unfinished = re.subn(r'!([a-z]+\.endedAt)\b', r'\1===null', source)
changes = {'unfinished': unfinished}
for before, after in [
    ('if(!h||h.formedAt)return', 'if(!h||h.formedAt!==null)return'),
    ('h.formedAt?', 'h.formedAt!==null?'),
    ('x.formedAt?', 'x.formedAt!==null?'),
    ('h=>h.formedAt)', 'h=>h.formedAt!==null)'),
    ('&&e.endedAt&&', '&&e.endedAt!==null&&'),
    ('e=>e.endedAt&&', 'e=>e.endedAt!==null&&'),
    ('&&e.endedAt)', '&&e.endedAt!==null)'),
    ('e=>e.endedAt)', 'e=>e.endedAt!==null)'),
    ("s.end?dt(s.end):'正在计时'", "s.end!==null?dt(s.end):'正在计时'"),
]:
    changes[before] = source.count(before)
    source = source.replace(before, after)
if not unfinished:
    raise SystemExit('No timestamp predicates changed; inspect source before rerunning.')
with target.open('w', encoding='utf-8', newline='\n') as output:
    output.write(source)
print(changes)
