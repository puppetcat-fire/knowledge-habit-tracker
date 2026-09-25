# android-build.ps1 — 下载工具链并打包 APK（幂等，可重复运行）
$ErrorActionPreference = "Continue"
$root = "C:\Users\66\android-build"
$sdk = "$root\sdk"
$jdk = "$root\jdk17"
$gradle = "$root\gradle-8.11.1"
$proj = "C:\Users\66\Documents\habbit\knowledge-habit-tracker\android-overlay"

function Log($m) { Write-Output "[$(Get-Date -Format HH:mm:ss)] $m" }

New-Item -ItemType Directory -Force -Path $root | Out-Null

# --- JDK 17 ---
if (-not (Test-Path "$jdk\bin\java.exe")) {
  Log "downloading JDK 17 (Temurin)..."
  try {
    Invoke-WebRequest -Uri "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse" -OutFile "$root\jdk.zip" -UseBasicParsing
    Expand-Archive "$root\jdk.zip" -DestinationPath "$root\jdk-tmp" -Force
    $d = Get-ChildItem "$root\jdk-tmp" -Directory | Select-Object -First 1
    Move-Item $d.FullName $jdk -Force
    Remove-Item "$root\jdk.zip","$root\jdk-tmp" -Recurse -Force -ErrorAction SilentlyContinue
    Log "JDK ready"
  } catch { Log "JDK FAIL: $($_.Exception.Message)" }
} else { Log "JDK exists, skip" }

# --- Gradle 8.11.1 ---
if (-not (Test-Path "$gradle\bin\gradle.bat")) {
  Log "downloading Gradle 8.11.1..."
  try {
    Invoke-WebRequest -Uri "https://services.gradle.org/distributions/gradle-8.11.1-bin.zip" -OutFile "$root\gradle.zip" -UseBasicParsing
    Expand-Archive "$root\gradle.zip" -DestinationPath $root -Force
    Remove-Item "$root\gradle.zip" -Force
    Log "Gradle ready"
  } catch { Log "Gradle FAIL: $($_.Exception.Message)" }
} else { Log "Gradle exists, skip" }

# --- Android cmdline-tools ---
if (-not (Test-Path "$sdk\cmdline-tools\latest\bin\sdkmanager.bat")) {
  Log "downloading Android cmdline-tools..."
  try {
    $xml = (Invoke-WebRequest -Uri "https://dl.google.com/android/repository/repository2-1.xml" -UseBasicParsing).Content
    $rel = ([regex]::Match($xml, 'commandlinetools-win-\d+_latest\.zip')).Value
    $url = "https://dl.google.com/android/repository/$rel"
    Log "cmdline url: $url"
    Invoke-WebRequest -Uri $url -OutFile "$root\cmdline.zip" -UseBasicParsing
    New-Item -ItemType Directory -Force -Path "$sdk\cmdline-tools" | Out-Null
    Expand-Archive "$root\cmdline.zip" -DestinationPath "$root\cmdline-tmp" -Force
    Move-Item "$root\cmdline-tmp\cmdline-tools" "$sdk\cmdline-tools\latest" -Force
    Remove-Item "$root\cmdline.zip","$root\cmdline-tmp" -Recurse -Force -ErrorAction SilentlyContinue
    Log "cmdline-tools ready"
  } catch { Log "cmdline-tools FAIL: $($_.Exception.Message)" }
} else { Log "cmdline-tools exist, skip" }

# --- env ---
$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:PATH = "$jdk\bin;$sdk\cmdline-tools\latest\bin;$sdk\platform-tools;$env:PATH"

# --- local.properties ---
"sdk.dir=$($sdk -replace '\\','/')" | Set-Content "$proj\local.properties" -Encoding ASCII
Log "local.properties written"

# --- SDK packages ---
if (-not (Test-Path "$sdk\platforms\android-35")) {
  Log "accepting licenses..."
  (1..200 | ForEach-Object { "y" }) | & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --licenses 2>&1 | Out-Null
  Log "installing SDK packages (platform-tools, platforms;android-35, build-tools;35.0.0)..."
  & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
  Log "SDK packages done (exit=$LASTEXITCODE)"
} else { Log "SDK platform exists, skip" }

# --- build ---
Log "building APK (first run downloads AGP + deps)..."
Push-Location $proj
& "$gradle\bin\gradle.bat" --no-daemon --console=plain assembleDebug
$code = $LASTEXITCODE
Pop-Location
Log "gradle exit=$code"

if ($code -eq 0) {
  Get-ChildItem "$proj\app\build\outputs\apk\debug" -ErrorAction SilentlyContinue |
    Select-Object Name, Length | ForEach-Object { Log "APK: $($_.Name)  $([math]::Round($_.Length/1MB,2)) MB" }
} else {
  Log "BUILD FAILED — see gradle output above"
}
