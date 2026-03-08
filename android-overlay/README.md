# Android Overlay MVP

这是一个单独的 Android 原生骨架，用来验证“常驻小计时条”这条产品线。

当前范围只包含：

- 悬浮窗权限申请入口
- 前台服务 `OverlayTimerService`
- 常驻小计时条
- 开始 / 暂停 / 重置
- 当前动作文本
- 拖动记忆位置
- 展开 / 收起控制按钮

## 目录

- `app/src/main/java/.../MainActivity.kt`
- `app/src/main/java/.../overlay/OverlayTimerService.kt`
- `app/src/main/java/.../overlay/OverlayTimerStore.kt`
- `app/src/main/res/layout/overlay_timer_view.xml`

## 运行方式

建议直接用 Android Studio 打开 `android-overlay` 目录。

首次运行：

1. 打开 App
2. 点击“打开系统悬浮权限页”
3. 给 App 授权
4. 点击“启动悬浮计时条”
5. 再用“开始计时 / 暂停计时 / 重置计时”控制

## 当前实现边界

- 它还没有接你现有网页项目的数据
- 它先是一个独立 Android MVP
- 目标是先验证“安卓常驻小计时条”是否真值得长期维护

## 下一步建议

- 给悬浮条加“点一下展开动作输入 / 随手记”
- 接网页导出的 JSON，做一次性导入
- 如果要长期用，再考虑与网页共用数据模型
