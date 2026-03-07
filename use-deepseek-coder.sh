#!/bin/bash
# 使用DeepSeek Coder技能优化知识习惯跟踪器

echo "🔧 使用DeepSeek Coder技能优化代码"
echo "======================================"

# 检查API密钥
if [ -z "$DEEPSEEK_API_KEY" ]; then
    echo "❌ 未设置DEEPSEEK_API_KEY环境变量"
    echo ""
    echo "📋 获取API密钥步骤："
    echo "1. 访问 https://platform.deepseek.com/api_keys"
    echo "2. 注册/登录获取API密钥"
    echo "3. 设置环境变量："
    echo "   export DEEPSEEK_API_KEY='your_api_key_here'"
    echo ""
    echo "📝 或者添加到 ~/.openclaw/.env："
    echo "   DEEPSEEK_API_KEY=your_api_key_here"
    echo ""
    echo "🔍 已完成的转换工作："
    echo "✅ 创建了 app-offline.js - 完全离线版本"
    echo "✅ 创建了 index-offline.html - 离线HTML界面"
    echo "✅ 添加了数据导出/导入功能"
    echo "✅ 移除了所有服务器API依赖"
    echo ""
    echo "🚀 可以直接使用已生成的离线版本："
    echo "   ./package-offline.sh  # 打包分发"
    echo "   # 然后分发 knowledge-habit-tracker-single.html"
    exit 1
fi

echo "✅ API密钥已配置"
echo ""

# 1. 审查现有代码
echo "📋 任务1: 审查app-offline.js代码"
deepseek-code --context "$(cat app-offline.js | head -500)" "审查这段JavaScript代码，指出潜在问题，建议优化点，特别是LocalStorage使用和错误处理方面。"

echo ""
echo "---"
echo ""

# 2. 优化数据导出功能
echo "📋 任务2: 优化数据导出功能"
deepseek-code --context "$(grep -A 50 'function exportAllData' app-offline.js)" "优化这个数据导出函数，添加进度提示、压缩选项、分块导出功能。"

echo ""
echo "---"
echo ""

# 3. 增强错误处理
echo "📋 任务3: 增强错误处理"
deepseek-code "为LocalStorage操作编写一个健壮的包装函数，包含以下功能：
1. 容量检查
2. 序列化/反序列化错误处理
3. 数据类型验证
4. 版本兼容性
5. 回退机制"

echo ""
echo "---"
echo ""

# 4. 添加PWA支持
echo "📋 任务4: 添加PWA支持"
deepseek-code "为这个离线应用添加基本的PWA(渐进式Web应用)支持，包括：
1. Service Worker用于离线缓存
2. Web App Manifest
3. 安装提示
4. 离线检测"

echo ""
echo "======================================"
echo "✅ DeepSeek Coder技能使用完成"
echo ""
echo "💡 提示：可以将生成的代码整合到现有文件中"
echo "📁 查看完整离线版：./package-offline.sh"