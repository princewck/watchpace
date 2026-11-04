# 开发与验证

普通用户在同一个 iOS App 中选择服务，不需要编译或签名。以下仅供修改源码的贡献者使用。

## 服务端

Node.js 24：

```sh
cd server
npm ci --ignore-scripts
npm test
npm run build:node
npm run format:check
```

测试覆盖家庭隔离、注册和恢复、重试幂等、真实心跳、安装重置、设备移除、离线采样和局域网签名。`npm run benchmark` 仅使用临时数据库，测量业务处理与磁盘 SQLite，不代表公网并发容量。

## iOS

需要支持 iOS 26 SDK 的 Xcode 和 XcodeGen，最低运行系统为 iOS 17。运行 `xcodegen generate --spec ios/project.yml`，打开生成工程。模拟器测试无需 Apple 开发者凭证；真机源码构建需要自己的开发团队和签名授权，不使用维护者证书。

```sh
xcodebuild -project ios/FamilyTV.xcodeproj -scheme FamilyTV \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

模拟器名称以本机实际安装为准。构建前先运行仓库根目录的 `python3 scripts/check-distribution.py --fetch`，恢复本地缺失的固定发行文件。正式归档先加 `--online` 核对线上 ZIP、APK 和清单，再执行 Xcode Archive。

## Android TV

已验证工具组合为 JDK 21、Gradle 8.9、Android SDK 34、Build Tools 34.0.0。设置 `JAVA_HOME`、`ANDROID_HOME` 和 `GRADLE` 后运行 `bash android/build.sh`。Release 构建另需通过环境变量提供自己的签名配置；安装到已有电视时，签名不同不能覆盖升级，脚本会停止，不自动卸载。

不要把 instrumentation 测试安装到家庭电视上。应使用可丢弃的 Android TV 模拟器，先构建 `:app:assembleDebugAndroidTest`。真实设备验收仍需家长实际播放、暂停、关闭 ADB 并完整重启，模拟器不能替代。

## 发布安装文件

`installer/family-tv-setup/assets/release.json` 固定 APK 版本、大小、SHA-256、签名指纹及下载站 `download_origin`。它不配置电视的服务 endpoint。

修改 APK 时增加 `versionName` 和 `versionCode`；修改技能时增加 `skill_version`。更新清单后运行：

```sh
python3 scripts/package-distribution.py
python3 scripts/check-distribution.py --write
python3 scripts/test-distribution.py
```

不同字节不得覆盖已发布版本。把新文件部署到发行清单指定的静态托管，再运行 `python3 scripts/check-distribution.py --online`。手机地址从发行清单生成，翻译文案只插入该地址，不能手写版本 URL。安装截图必须始终显示独立的完整服务 endpoint。
