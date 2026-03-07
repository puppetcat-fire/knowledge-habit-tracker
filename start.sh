#!/bin/bash

# 知识习惯跟踪器启动脚本
# 提供简单和增强安全两种启动方式

set -e

echo "🚀 知识习惯跟踪器启动脚本"
echo "=============================="

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到Node.js，请先安装Node.js"
    exit 1
fi

# 检查npm依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
fi

# 选择启动模式
echo ""
echo "请选择启动模式："
echo "1. 简单模式 (server.js) - 快速启动，基础功能"
echo "2. 安全模式 (server-secure.js) - 增强安全，更多配置"
echo "3. 查看安全指南"
echo "4. 退出"
echo ""

read -p "请输入选择 [1-4]: " choice

case $choice in
    1)
        echo "🔧 启动简单模式..."
        echo "📝 使用 server.js"
        echo "🌐 访问: http://localhost:3000"
        echo ""
        node server.js
        ;;
    2)
        echo "🔒 启动安全模式..."
        
        # 检查安全依赖
        if ! npm list helmet 2>/dev/null | grep -q helmet; then
            echo "📦 安装安全依赖..."
            npm install helmet cors express-rate-limit
        fi
        
        # 检查环境文件
        if [ ! -f ".env" ]; then
            echo "📄 未找到 .env 文件，使用默认配置"
            echo "💡 提示: 复制 .env.example 为 .env 可自定义配置"
        fi
        
        echo "📝 使用 server-secure.js"
        echo "🌐 访问: http://localhost:3000"
        echo "📊 健康检查: http://localhost:3000/health"
        echo ""
        
        # 加载环境变量
        if [ -f ".env" ]; then
            export $(grep -v '^#' .env | xargs)
        fi
        
        node server-secure.js
        ;;
    3)
        echo "📖 安全指南"
        echo "============"
        if [ -f "SECURITY.md" ]; then
            cat SECURITY.md | head -50
            echo ""
            echo "... (完整内容查看 SECURITY.md 文件)"
        else
            echo "安全指南文件未找到"
        fi
        ;;
    4)
        echo "退出"
        exit 0
        ;;
    *)
        echo "❌ 无效选择"
        exit 1
        ;;
esac