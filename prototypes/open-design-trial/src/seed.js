// 试作种子数据：全部是模拟内容，明确标为演示。时间相对当前时刻生成。
import { startOfWeek } from './domain/habits.js';

const DAY = 24 * 60 * 60 * 1000;

function finishedEvent({ id, name, habitId = null, knowledge = null, endedAt, minutes, notes = [], stepsDone = [], segments = null }) {
  const startedAt = endedAt - minutes * 60 * 1000;
  return {
    id,
    name,
    habitId,
    knowledge,
    startedAt,
    endedAt,
    segments: segments || [{ startedAt, endedAt }],
    notes,
    draftNote: '',
    parentId: null,
    parentStepId: null,
    stepDone: stepsDone
  };
}

function atHour(dayStart, hour, minute = 0) {
  const date = new Date(dayStart);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

export function buildSeedState(now = Date.now()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const thisWeek = startOfWeek(now);

  const knowledge = {
    trees: [
      {
        id: 'trial-tree',
        title: '把想做的事变成能开始的事',
        subtitle: '演示知识树 · 节点是目标，方法是做法，默认折叠',
        nodes: [
          { id: 'n-start', name: '能开始一件一直拖着的事', goal: '不靠意志力，先把身体挪到动作上。', area: 'base', estMinutes: 5, prereqs: [], examples: ['n-five'], x: 150, y: 140 },
          { id: 'n-split', name: '把大任务拆出一个五分钟小步', goal: '拆到「下一步动作」而不是「一个大项目」。', area: 'base', estMinutes: 5, prereqs: ['n-start'], examples: [], x: 150, y: 300 },
          { id: 'n-estimate', name: '估算一件事的真实用时', goal: '用记录校准预估，而不是凭感觉。', area: 'base', estMinutes: 5, prereqs: ['n-feedback'], examples: [], x: 150, y: 460 },
          { id: 'n-perception', name: '知道自己的时间去了哪里', goal: '能说出今天时间的大致分布。', area: 'base', estMinutes: 5, prereqs: [], examples: [], x: 150, y: 600 },
          { id: 'n-five', name: '用五分钟把自己推进动作', goal: '五分钟只负责开始，不负责做完。', area: 'method', estMinutes: 5, prereqs: ['n-start'], examples: [], x: 330, y: 140 },
          { id: 'n-pomodoro', name: '用 25 分钟块工作', goal: '在一个块里只处理一件事。', area: 'method', estMinutes: 15, prereqs: ['n-single'], examples: [], x: 330, y: 270 },
          { id: 'n-desk', name: '两分钟清一次桌面', goal: '减少下一次开始的阻力。', area: 'method', estMinutes: 5, prereqs: [], examples: [], x: 330, y: 400 },
          { id: 'n-idea', name: '把脑内的想法倒到纸上', goal: '先卸下占用的注意力，再决定做不做。', area: 'method', estMinutes: 5, prereqs: [], examples: [], x: 330, y: 530 },
          { id: 'n-env', name: '让开始动作的阻力更小', goal: '把要用的东西提前放到手边。', area: 'method', estMinutes: 5, prereqs: ['n-start'], examples: [], x: 330, y: 660 },
          { id: 'n-read', name: '读完一节并留下一句笔记', goal: '读完一节，留下一句能复述的话。', area: 'practice', estMinutes: 15, prereqs: ['n-split'], examples: [], x: 560, y: 120 },
          { id: 'n-verbatim', name: '摘一句原话而不是转述', goal: '先留住原文，再谈理解。', area: 'practice', estMinutes: 5, prereqs: ['n-read'], examples: [], x: 560, y: 250 },
          { id: 'n-question', name: '给自己提一个能回答的问题', goal: '把读过的内容变成一个可验证的问题。', area: 'practice', estMinutes: 5, prereqs: ['n-verbatim'], examples: [], x: 560, y: 370 },
          { id: 'n-log', name: '写一段真实的工作日志', goal: '写下今天实际做了什么，不评估好坏。', area: 'practice', estMinutes: 10, prereqs: ['n-split'], examples: [], x: 560, y: 500 },
          { id: 'n-inbox', name: '清空一次收件箱', goal: '把待处理的东西移出注意力。', area: 'practice', estMinutes: 15, prereqs: [], examples: [], x: 560, y: 640 },
          { id: 'n-review', name: '做一次十五分钟的周回顾', goal: '看记录，找出下周要调整的一件事。', area: 'practice', estMinutes: 15, prereqs: ['n-feedback'], examples: [], x: 790, y: 560 },
          { id: 'n-single', name: '一段时间里只做一件事', goal: '减少切换，让注意力留在同一处。', area: 'principle', estMinutes: 5, prereqs: [], examples: ['n-pomodoro'], x: 790, y: 120 },
          { id: 'n-residue', name: '知道切换会留下注意力残留', goal: '理解为什么切走再切回要花时间。', area: 'principle', estMinutes: 5, prereqs: [], examples: [], x: 790, y: 250 },
          { id: 'n-feedback', name: '用记录形成反馈回路', goal: '记录 → 回看 → 调整，而不是只记录。', area: 'principle', estMinutes: 10, prereqs: ['n-single'], examples: ['n-review'], x: 790, y: 380 },
          { id: 'n-stop', name: '累了就停，而不是拖到做不下去', goal: '在还能停的时候停下。', area: 'principle', estMinutes: 5, prereqs: [], examples: [], x: 950, y: 180 },
          { id: 'n-tiny', name: '小步带来的正反馈', goal: '用可见的小完成维持继续的意愿。', area: 'principle', estMinutes: 5, prereqs: [], examples: [], x: 950, y: 320 }
        ],
        methods: [
          {
            id: 'm-five', nodeId: 'n-start', title: '五分钟启动法', version: 3, updatedAt: now - 6 * DAY, visibility: 'public', owner: '演示',
            firstFive: '把材料打开，定五分钟，只做不追求做完。',
            steps: [
              { id: 'm-five-1', text: '把要做的东西放到眼前（书、文档、工具）' },
              { id: 'm-five-2', text: '设五分钟，只做这一件事' },
              { id: 'm-five-3', text: '五分钟到了，只决定「继续」或「停在这里」' }
            ]
          },
          {
            id: 'm-split', nodeId: 'n-split', title: '拆一步', version: 1, updatedAt: now - 20 * DAY, visibility: 'public', owner: '演示',
            firstFive: '把目标改写成「一个动词 + 一个物件」。',
            steps: [
              { id: 'm-split-1', text: '写下目标原来的说法' },
              { id: 'm-split-2', text: '改写成下一步动作：打开、拿出、写下' },
              { id: 'm-split-3', text: '挑一个五分钟能做完的版本' }
            ]
          },
          {
            id: 'm-read', nodeId: 'n-read', title: '一节阅读法', version: 2, updatedAt: now - 2 * DAY, visibility: 'public', owner: '演示',
            firstFive: '先读第一段，读到想停的地方写下页码。',
            steps: [
              { id: 'm-read-1', text: '打开要读的那一节，关掉其它标签页' },
              { id: 'm-read-2', text: '读完一节，不打断' },
              { id: 'm-read-3', text: '摘一句原话，不转述' }
            ]
          },
          {
            id: 'm-log', nodeId: 'n-log', title: '三问日志', version: 1, updatedAt: now - 9 * DAY, visibility: 'private', owner: '我',
            firstFive: '先写第一问的一句话，不求完整。',
            steps: [
              { id: 'm-log-1', text: '今天实际做了什么？' },
              { id: 'm-log-2', text: '哪一段最消耗？' },
              { id: 'm-log-3', text: '明天想调的一件事？' }
            ]
          },
          {
            id: 'm-single', nodeId: 'n-single', title: '单任务计时', version: 2, updatedAt: now - 12 * DAY, visibility: 'public', owner: '演示',
            firstFive: '先把手机放到看不见的地方，再开始计时。',
            steps: [
              { id: 'm-single-1', text: '选一件要做的事' },
              { id: 'm-single-2', text: '开始正向计时' },
              { id: 'm-single-3', text: '结束时记一句真实感受' }
            ]
          },
          {
            id: 'm-review', nodeId: 'n-review', title: '十五分钟周回顾', version: 1, updatedAt: now - 15 * DAY, visibility: 'public', owner: '演示',
            firstFive: '只看本周记录的前三条，不要从头读。',
            steps: [
              { id: 'm-review-1', text: '看本周实际用时分布' },
              { id: 'm-review-2', text: '找出一次和预期差距最大的事' },
              { id: 'm-review-3', text: '给下周留一条调整' }
            ]
          },
          {
            id: 'm-desk', nodeId: 'n-desk', title: '两分钟清桌', version: 1, updatedAt: now - 30 * DAY, visibility: 'public', owner: '演示',
            firstFive: '先把水杯和纸收走，其余不管。',
            steps: [
              { id: 'm-desk-1', text: '收走不需要的东西' },
              { id: 'm-desk-2', text: '只留今天要用的材料' }
            ]
          }
        ]
      }
    ]
  };

  // 归属：公共节点属于全部点亮者，私人节点只属于个人（试作里给两个节点做私人示例）。
  const privateNodeIds = new Set(['n-log', 'n-question']);
  for (const item of knowledge.trees[0].nodes) {
    item.ownership = privateNodeIds.has(item.id) ? 'private' : 'public';
  }

  const events = [
    finishedEvent({
      id: 'seed-read-today', name: '每天读一段', habitId: 'habit-read', endedAt: atHour(todayStart, 8, 20), minutes: 16,
      notes: [{ id: 'seed-note-1', text: '第八章讲反馈回路，读完先记一句：记录不是盘点，是给自己下一次的信号。', at: atHour(todayStart, 8, 36) }],
      stepsDone: ['s-book', 's-read']
    }),
    finishedEvent({
      id: 'seed-read-practice', name: '读完一节并留下一句笔记', knowledge: { treeId: 'trial-tree', nodeId: 'n-read', methodId: 'm-read', methodVersion: 2 },
      endedAt: atHour(todayStart - DAY, 21, 10), minutes: 14,
      notes: [{ id: 'seed-note-2', text: '原话：注意力不是被抢走的，是被自己交出去的。', at: atHour(todayStart - DAY, 21, 24) }],
      stepsDone: ['m-read-1', 'm-read-2', 'm-read-3']
    }),
    finishedEvent({
      id: 'seed-rise', name: '起床', endedAt: atHour(todayStart - DAY, 7, 10), minutes: 22,
      stepsDone: ['s-water', 's-brush'],
      segments: [
        { startedAt: atHour(todayStart - DAY, 6, 48), endedAt: atHour(todayStart - DAY, 6, 55) },
        { startedAt: atHour(todayStart - DAY, 7, 0), endedAt: atHour(todayStart - DAY, 7, 10) }
      ],
      notes: [{ id: 'seed-note-3', text: '今天刷牙前先喝了水，比平时顺。', at: atHour(todayStart - DAY, 7, 11) }]
    }),
    finishedEvent({
      id: 'seed-game', name: '打游戏', endedAt: atHour(todayStart - DAY, 22, 40), minutes: 45,
      notes: []
    }),
    finishedEvent({
      id: 'seed-report', name: '写周报', endedAt: atHour(todayStart - 2 * DAY, 17, 30), minutes: 28,
      notes: [{ id: 'seed-note-4', text: '用三问日志开了个头，比从空白页开始快。', at: atHour(todayStart - 2 * DAY, 17, 58) }],
      stepsDone: []
    }),
    finishedEvent({
      id: 'seed-review', name: '做一次十五分钟的周回顾', knowledge: { treeId: 'trial-tree', nodeId: 'n-review', methodId: 'm-review', methodVersion: 1 },
      endedAt: atHour(todayStart - 3 * DAY, 20, 0), minutes: 15,
      notes: [{ id: 'seed-note-5', text: '发现「打游戏」每周四晚上最多，接受它，不硬改。', at: atHour(todayStart - 3 * DAY, 20, 15) }]
    })
  ];

  // 当前习惯的历史：上周 5 次、两周前 5 次、三周前 4 次（差一次达成连续四周）。
  const weekPlan = [
    { index: 1, days: [0, 1, 3, 4, 6] },
    { index: 2, days: [1, 2, 3, 5, 6] },
    { index: 3, days: [0, 2, 4, 5] }
  ];
  for (const plan of weekPlan) {
    const weekStart = thisWeek - plan.index * 7 * DAY;
    plan.days.forEach((dayOffset, position) => {
      events.push(finishedEvent({
        id: `seed-habit-${plan.index}-${position}`,
        name: '每天读一段',
        habitId: 'habit-read',
        endedAt: atHour(weekStart + dayOffset * DAY, 8 + (position % 3), 10),
        minutes: 12 + position
      }));
    });
  }
  // 已养成习惯的历史（睡前刷牙）
  for (let index = 0; index < 6; index += 1) {
    const day = todayStart - (5 + index) * DAY;
    events.push(finishedEvent({
      id: `seed-brush-${index}`,
      name: '睡前刷牙',
      habitId: 'habit-brush',
      endedAt: atHour(day, 22, 40),
      minutes: 4
    }));
  }

  return {
    version: 1,
    account: null,
    currentHabitId: 'habit-read',
    habits: [
      { id: 'habit-read', name: '每天读一段', createdAt: todayStart - 26 * DAY, formedAt: null },
      { id: 'habit-walk', name: '晨间散步', createdAt: todayStart - 40 * DAY, formedAt: null },
      { id: 'habit-brush', name: '睡前刷牙', createdAt: todayStart - 90 * DAY, formedAt: todayStart - 20 * DAY }
    ],
    stepTemplates: {
      起床: [
        { id: 's-water', text: '喝一杯水' },
        { id: 's-brush', text: '刷牙' },
        { id: 's-curtain', text: '拉开窗帘' }
      ],
      每天读一段: [
        { id: 's-book', text: '打开要读的书' },
        { id: 's-read', text: '读一节' },
        { id: 's-line', text: '记一句话' }
      ]
    },
    noteTemplates: {
      起床: '起床时先喝水再刷牙，别先看手机。',
      每天读一段: '读之前先把手机放远一点；读不完一节就记下停在哪。'
    },
    events,
    knowledge,
    lightups: [
      { id: 'light-seed-1', nodeId: 'n-start', methodId: 'm-five', eventId: null, at: todayStart - 18 * DAY, state: 'confirmed', visibility: 'private', confirmedAt: todayStart - 18 * DAY },
      { id: 'light-seed-2', nodeId: 'n-split', methodId: 'm-split', eventId: null, at: todayStart - 16 * DAY, state: 'confirmed', visibility: 'private', confirmedAt: todayStart - 16 * DAY },
      { id: 'light-seed-3', nodeId: 'n-single', methodId: 'm-single', eventId: null, at: todayStart - 10 * DAY, state: 'confirmed', visibility: 'public', confirmedAt: todayStart - 10 * DAY },
      { id: 'light-seed-4', nodeId: 'n-read', methodId: 'm-read', eventId: 'seed-read-practice', at: todayStart - DAY, state: 'draft', visibility: 'private' }
    ],
    ui: {
      sidebarCollapsed: false,
      collapsedGroups: [],
      recordsRange: 'today',
      recordsDate: '',
      authTab: 'login'
    }
  };
}
