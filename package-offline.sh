#!/bin/bash

# 知识习惯跟踪器 - 离线版打包脚本
# 创建一个完整的离线分发包

set -e

echo "📦 知识习惯跟踪器 - 离线版打包工具"
echo "======================================"

# 创建输出目录
OUTPUT_DIR="knowledge-habit-tracker-offline-$(date +%Y%m%d)"
mkdir -p "$OUTPUT_DIR"

echo "📁 创建输出目录: $OUTPUT_DIR"

# 复制必要文件
echo "📄 复制文件..."
cp index-offline.html "$OUTPUT_DIR/index.html"
cp app-offline.js "$OUTPUT_DIR/app.js"
cp style.css "$OUTPUT_DIR/"
cp README-OFFLINE.md "$OUTPUT_DIR/README.md"
cp LICENSE "$OUTPUT_DIR/"
cp SECURITY.md "$OUTPUT_DIR/" 2>/dev/null || true

# 创建精简版（单文件版本）
echo "🔧 创建单文件版本..."
SINGLE_FILE="$OUTPUT_DIR/knowledge-habit-tracker-single.html"

# 读取CSS内容
CSS_CONTENT=$(cat style.css)

# 读取JS内容
JS_CONTENT=$(cat app-offline.js)

# 创建单文件HTML
cat > "$SINGLE_FILE" << EOF
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>知识习惯跟踪器 - 单文件离线版</title>
    <style>
        /* 离线标识 */
        .offline-badge {
            position: fixed;
            top: 10px;
            right: 10px;
            background: #4CAF50;
            color: white;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
            z-index: 1000;
        }
        $CSS_CONTENT
    </style>
</head>
<body>
    <div class="offline-badge" title="完全离线运行，无需服务器">🔋 单文件版</div>
    
    <div class="app">
      <header class="header">
        <div>
          <h1>知识习惯跟踪器</h1>
          <p class="subtitle">Done List 只记录你做了什么</p>
          <p style="font-size: 0.9rem; color: #666; margin-top: 0.25rem;">
            🔋 单文件离线版 - 所有数据存储在您的浏览器中
          </p>
        </div>
        <div class="connection">
          <label class="toggle">
            <input id="hub-connected" type="checkbox" disabled />
            <span>离线模式</span>
          </label>
        </div>
      </header>

      <nav class="nav">
        <button class="nav-button active" type="button" data-page-target="timer">计时</button>
        <button class="nav-button" type="button" data-page-target="habit">习惯</button>
        <button class="nav-button" type="button" data-page-target="bug">Bug 收集</button>
      </nav>

      <section class="page" data-page="timer">
        <div class="panel timer-panel">
          <h2>专注计时</h2>
          <div id="habit-reminder" class="reminder hidden"></div>
          <div class="timer-predict">
            <label for="timer-prediction">本次行动预测</label>
            <div class="input-row">
              <input id="timer-prediction" type="text" maxlength="80" placeholder="例如：完成阅读与复盘" />
              <button id="habit-picker-toggle" class="icon-button" type="button">+</button>
            </div>
          </div>
          <div class="timer-actions timer-actions-top">
            <button id="timer-start" class="primary" type="button">开始</button>
            <button id="timer-reset" class="secondary" type="button">重置</button>
            <button id="timer-finish" class="secondary" type="button">结束并生成战报</button>
          </div>
          <div id="timer-display" class="timer-display">00:00:00</div>
          <div id="timer-prediction-display" class="timer-prediction-display">未预测</div>
          <div id="timer-suggestions" class="timer-suggestions"></div>
          <div id="habit-picker" class="habit-picker hidden">
            <div class="habit-picker-header">
              <span>计时习惯</span>
              <span id="timer-habit-label" class="save-status"></span>
            </div>
            <div class="habit-picker-search">
              <input id="habit-picker-search" type="text" maxlength="40" placeholder="搜索习惯" />
            </div>
            <div id="habit-picker-list" class="habit-picker-list"></div>
          </div>
          <div class="habit-detail">
            <div class="habit-detail-row">
              <span>重复日志</span>
              <span id="timer-recurring-status" class="save-status"></span>
            </div>
            <textarea id="timer-recurring-log" class="habit-log" rows="3" maxlength="300" placeholder="例如：执行顺序、注意事项"></textarea>
          </div>
          <div class="timer-predict">
            <label for="timer-single-log">单次日志</label>
            <textarea id="timer-single-log" rows="3" maxlength="300" placeholder="例如：心情、感受"></textarea>
          </div>
          <div id="timer-report" class="report hidden"></div>
        </div>
      </section>

      <section class="page hidden" data-page="habit">
        <div class="panel">
          <h2>当前习惯</h2>
          <div id="habit-empty" class="empty-state">
            <p>一次只养成一个习惯，先创建你的第一个习惯。</p>
            <form id="habit-form" class="form">
              <div class="field">
                <label>习惯名称</label>
                <input id="habit-name" type="text" required maxlength="40" placeholder="例如：阅读30分钟" />
              </div>
              <div class="field">
                <label>养成周期（天）</label>
                <input id="habit-days" type="number" min="60" max="255" value="60" required />
              </div>
              <div class="field">
                <label>重复日志</label>
                <textarea id="habit-recurring-log" rows="3" maxlength="300" placeholder="例如：执行顺序、注意事项"></textarea>
              </div>
              <button class="primary" type="submit">开始养成</button>
            </form>
          </div>

          <div id="habit-active" class="habit-card hidden">
            <div class="habit-main">
              <div>
                <h3 id="habit-title"></h3>
                <p id="habit-meta"></p>
              </div>
              <div class="habit-actions">
              <button id="start-timer-from-habit" class="primary" type="button">从习惯开始计时</button>
                <button id="edit-habit" class="secondary" type="button">编辑</button>
                <button id="delete-habit" class="danger-button" type="button">删除</button>
                <button id="complete-habit" class="secondary" type="button">结束当前习惯</button>
              </div>
            </div>
            <div class="habit-progress">
              <div class="progress-row">
                <span>累计天数</span>
                <span id="habit-days-progress"></span>
              </div>
              <div class="progress-row">
                <span>连续4周达标</span>
                <span id="habit-weekly-status"></span>
              </div>
            </div>
            <div class="habit-detail"></div>
          </div>
        </div>

        <div class="panel">
          <h2>习惯历史</h2>
          <div id="habit-history-list" class="done-list"></div>
        </div>

        <div class="panel">
          <h2>完成记录（Done List）</h2>
          <form id="done-form" class="form">
            <div class="field">
              <label>今天完成了什么</label>
              <input id="done-title" type="text" required maxlength="80" placeholder="例如：读完一章" />
            </div>
            <div class="field">
              <label>单次日志</label>
              <textarea id="done-log" rows="3" maxlength="300" placeholder="例如：心情、感受"></textarea>
            </div>
            <button class="primary" type="submit">记录完成</button>
          </form>

          <div id="battle-report" class="report hidden"></div>

          <div class="filters">
            <button data-range="all" class="filter active" type="button">全部</button>
            <button data-range="yesterday" class="filter" type="button">昨天</button>
            <button data-range="week" class="filter" type="button">上周</button>
            <button data-range="month" class="filter" type="button">上个月</button>
          </div>

          <div id="done-list" class="done-list"></div>
        </div>

        <div class="panel">
          <h2>按习惯查看完成记录</h2>
          <div id="habit-event-groups" class="done-list"></div>
        </div>
      </section>

      <section class="page hidden" data-page="bug">
        <div class="panel">
          <h2>Bug 收集</h2>
          <p class="empty-state">此处用于收集你在使用中的问题与建议，数据存储在浏览器本地。</p>
          <form id="bug-form" class="form">
            <div class="field">
              <label>标题</label>
              <input id="bug-title" type="text" required maxlength="100" placeholder="简要说明问题" />
            </div>
            <div class="field">
              <label>问题描述</label>
              <textarea id="bug-description" rows="4" required maxlength="1000" placeholder="详细描述出现的问题"></textarea>
            </div>
            <div class="field">
              <label>复现步骤</label>
              <textarea id="bug-steps" rows="4" maxlength="1000" placeholder="一步步说明如何复现"></textarea>
            </div>
            <div class="field">
              <label>期望结果</label>
              <textarea id="bug-expected" rows="3" maxlength="500" placeholder="你希望的行为或结果"></textarea>
            </div>
            <div class="field">
              <label>实际结果</label>
              <textarea id="bug-actual" rows="3" maxlength="500" placeholder="实际发生了什么"></textarea>
            </div>
            <div class="field">
              <label>严重级别</label>
              <select id="bug-severity">
                <option value="low">低</option>
                <option value="medium" selected>中</option>
                <option value="high">高</option>
              </select>
            </div>
            <div class="field">
              <label>联系方式（可选）</label>
              <input id="bug-contact" type="text" maxlength="100" placeholder="Email 或其他联系方式" />
            </div>
            <button class="primary" type="submit">提交 Bug</button>
          </form>
          <div id="bug-status" class="report hidden"></div>
        </div>

        <div class="panel">
          <h2>最近提交</h2>
          <div id="bug-list" class="done-list"></div>
        </div>
      </section>
    </div>

    <script>
        // 内联JavaScript代码
        $JS_CONTENT
    </script>
</body>
</html>
EOF

echo "✅ 单文件版本创建完成: $SINGLE_FILE"

# 创建压缩包
echo "📦 创建压缩包..."
tar -czf "${OUTPUT_DIR}.tar.gz" "$OUTPUT_DIR"
zip -qr "${OUTPUT_DIR}.zip" "$OUTPUT_DIR"

echo "✅ 打包完成！"
echo ""
echo "📁 生成的文件："
echo "  - ${OUTPUT_DIR}/              # 完整离线版目录"
echo "  - ${OUTPUT_DIR}.tar.gz        # Linux/macOS压缩包"
echo "  - ${OUTPUT_DIR}.zip           # Windows压缩包"
echo ""
echo "🚀 使用方法："
echo "  1. 解压任意压缩包"
echo "  2. 用浏览器打开 index.html"
echo "  3. 开始使用完全离线的习惯跟踪器！"
echo ""
echo "💡 提示：单文件版本 (knowledge-habit-tracker-single.html) 可以单独分发，"
echo "       只需一个HTML文件即可运行全部功能。"