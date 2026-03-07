#!/bin/bash
# 使用DeepSeek Coder技能优化知识习惯跟踪器离线版本

set -e

echo "🔧 使用DeepSeek Coder技能优化代码"
echo "======================================"

DEEPSEEK_SCRIPT="/home/admin/.openclaw/workspace/skills/deepseek-coder/deepseek-code-enhanced.sh"

if [ ! -f "$DEEPSEEK_SCRIPT" ]; then
    echo "❌ 未找到DeepSeek Coder脚本"
    exit 1
fi

# 1. 审查现有代码
echo "📋 任务1: 审查app-offline.js代码结构"
echo "--------------------------------------"
"$DEEPSEEK_SCRIPT" --logger "审查这段JavaScript代码的结构和设计模式：

$(cat app-offline.js | head -200)

请分析：
1. 代码组织是否合理？
2. 是否有重复代码可以提取？
3. LocalStorage使用是否最佳实践？
4. 错误处理是否充分？
5. 性能优化建议"

echo ""
echo "---"
echo ""

# 2. 优化数据管理
echo "📋 任务2: 优化数据管理功能"
echo "--------------------------------------"
"$DEEPSEEK_SCRIPT" --logger "优化这个LocalStorage数据管理代码：

$(grep -A 30 'function exportAllData' app-offline.js)

需求：
1. 添加数据压缩（可选）
2. 添加分块导出（大数据量时）
3. 添加导出进度提示
4. 添加导入验证和回滚
5. 添加数据版本控制"

echo ""
echo "---"
echo ""

# 3. 添加PWA支持
echo "📋 任务3: 添加PWA支持"
echo "--------------------------------------"
"$DEEPSEEK_SCRIPT" --logger "为这个完全离线的习惯跟踪器添加PWA(渐进式Web应用)支持：

1. 创建Service Worker文件，缓存所有资源
2. 创建Web App Manifest文件
3. 添加离线检测和提示
4. 添加安装到主屏幕功能
5. 确保完全离线可用性

请提供完整的代码实现。"

echo ""
echo "---"
echo ""

# 4. 增强错误处理
echo "📋 任务4: 增强错误处理"
echo "--------------------------------------"
"$DEEPSEEK_SCRIPT" --logger "创建健壮的LocalStorage包装函数，包含：

1. 容量检查（LocalStorage通常5MB限制）
2. 序列化/反序列化错误处理
3. 数据类型验证
4. 版本兼容性处理
5. 优雅降级（如LocalStorage不可用）
6. 自动清理过期数据

请提供完整的JavaScript实现。"

echo ""
echo "---"
echo ""

# 5. 优化用户界面
echo "📋 任务5: 优化用户界面"
echo "--------------------------------------"
"$DEEPSEEK_SCRIPT" --logger "优化这个习惯跟踪器的用户界面：

当前HTML结构：
$(cat index-offline.html | grep -A 5 -B 5 'class="app"' | head -20)

需求：
1. 添加响应式设计
2. 添加暗色模式支持
3. 优化移动端体验
4. 添加加载状态和动画
5. 添加键盘快捷键支持

请提供CSS和JavaScript代码。"

echo ""
echo "======================================"
echo "✅ DeepSeek Coder优化任务完成"
echo ""
echo "💡 提示：将生成的代码整合到现有文件中"
echo "📁 查看完整离线版：./package-offline.sh"