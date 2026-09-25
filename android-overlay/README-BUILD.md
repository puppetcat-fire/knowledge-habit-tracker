# 打包 / 调试 Android（需在能联网的机器上）

本目录 `android-overlay` 是标准 Gradle 项目（Kotlin + viewBinding，无 wrapper）。
DSH 沙箱无出站网络、无 JDK/SDK/Gradle，**无法在此打包**——需要在你的机器上执行。

## 方式一：Android Studio（推荐，最简单）

1. 安装 Android Studio（自带 JDK + SDK + 模拟器）
2. `Open` → 选择 `android-overlay` 目录
3. 等 Gradle sync 完成（首次会下载依赖）
4. 连真机（开发者选项 → USB 调试）或起模拟器 → 点 **Run ▶**

## 方式二：纯命令行（不装 Android Studio）

前置：JDK 17 + Android SDK 命令行工具。

```powershell
# 1) 下载并解压 commandlinetools-win-*.zip（Google 官方）
#    https://developer.android.com/studio#command-line-tools-only

# 2) 接受许可 + 装组件
sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"

# 3) 生成 gradle wrapper（本目录没有 wrapper，需要本地 Gradle 跑一次）
#    没有 gradle 就装：winget install Gradle.Gradle
gradle wrapper --gradle-version 8.9

# 4) 打包
$env:ANDROID_HOME = "你的SDK根目录"   # 例如 C:\Android\Sdk
.\gradlew assembleDebug

# 产物：app\build\outputs\apk\debug\app-debug.apk
```

## 调试

- **真机**：USB 连接 + 开发者选项开「USB 调试」→
  `adb install -r app-debug.apk`；看日志 `adb logcat`；屏幕截图 `adb shell screencap`
- **模拟器**（可选，比真机重）：
  `sdkmanager "emulator" "system-images;android-35;google_apis;x86_64"`
  `avdmanager create avd -n test -k "system-images;android-35;google_apis;x86_64"`

## M1 已就绪的代码（待编译验证）

- `tree/Tree.kt` — 树数据模型 + 从 assets 解析 `k9-math.json`
- `forest/ForestStore.kt` — 本地点亮存储（SharedPreferences）
- `ForestActivity.kt` — 看树（26 节点）→ 点开看目标/自证提示/折叠教程 → 自证点亮
- `activity_forest.xml` + 主界面「进入森林」入口 + manifest 注册
- 种子树：`app/src/main/assets/k9-math.json`

> 代码按现有 overlay 项目约定（org.json 解析 + SharedPreferences + 程序化 UI）写的，
> 未经编译。首次打包若有报错，把错误贴回来，我来修。
