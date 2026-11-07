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

## 单次观看规则

`session_limit_seconds` 为 `null` 时不限制单次时长；启用时最小值为 60 秒。`session_break_seconds` 默认为 300 秒，不能低于 300 秒。年龄预设只替换每日额度、单次上限和休息时长，应用前需要家长确认，已有休息时段保持不变。

服务端从已有的去重播放采样推导单次观看时间，随心跳返回 `session_used_seconds`、`session_last_play_ms` 和 `session_break_remaining_seconds`。电视将此摘要与尚未确认的本地播放采样合并，在断网时继续执行已保存的规则。停播不累计观看时间；短暂停顿和切换应用不会重置累计值。连续停止播放达到休息时长后才开始新一轮，休息期间再次播放会从最新播放时间重新计算休息。临时额度不跳过单次休息，家长暂停始终优先。

启用此规则前，需要服务端应用 `0007_session_rules.sql`，并更新手机和电视客户端。电视通过心跳报告 `session_rules_version: 1` 后，手机才允许应用带单次限制的年龄预设。自部署维护者先备份数据库，再在 `server` 目录、使用原来的 `SQLITE_PATH` 环境配置运行 `npm run init:node`；初始化流程只执行尚未应用的迁移，不覆盖已有数据。旧客户端不能从手机预设或手动编辑器启用单次限制；服务端配置接口也会拒绝这种设置。健康组织来源及产品预设与指南之间的区别，可在 App 的“年龄建议”中查看。

## 手机发起电视更新

在手机 App 的“我的 → 电视与连接设置”中，点击“电视客户端更新”进入更新页面。手机从登录的服务获取最新版本，并完成 Apple App Attest 验证后下载 APK。手机与电视连接同一 Wi-Fi，通过已配对的加密连接传送。升级包不走配置指令的云端回退队列。旧电视须先通过电脑覆盖安装一次具备接收功能的客户端；收到其 `update_protocol_version: 1` 心跳后，手机才提供后续传送操作。

传输沿用已配对家长的签名和电视证书校验，使用 `update_begin`、`update_chunk`、`update_finish` 请求；分片上限 8192 字节，整包上限 8 MiB，上传有效期 15 分钟。电视校验包大小、SHA-256、应用包名、签名证书和真实版本号，只接受同一应用、同一签名且版本号更高的包。相同分片可以重试，内容冲突或越序会被拒绝。

包送达后，家长在电视上确认安装。若缺少安装权限，电视先打开对应系统设置；用户允许后返回继续。某些厂商固件不允许授予该权限，或限制后台打开安装页，此时使用电脑安装引导。更新覆盖原应用，不主动删除绑定、观看记录或已授予权限。安装后的心跳报告 `client_version_code`，手机以此确认结果，传输完成本身不代表安装成功。

正式升级包与首次安装包分别发行。首次安装继续使用上面的固定清单。正式升级包用 Gradle 的 `-PotaVersionCode` 和 `-PotaVersionName` 指定递增版本，沿用电视端签名。参考 `server/deploy/protected-tv-release.json` 生成 `latest.json`，将它和 `family-tv-<版本>.apk` 放在 `TV_UPDATE_ROOT` 指定的私有目录。先执行 `npm run init:node` 应用 `0008_update_downloads.sql`，再重启网关。网关启动时校验包大小和 SHA-256。

手机只展示网关公布的最新升级版本。下载挑战绑定当前登录、电视和版本，120 秒内仅能使用一次。每台电视每 24 小时最多下载 5 次，每个家庭 10 次，单个服务的 APK 下载总量上限为 64 MiB。网关每小时检查私有目录，清理超过 30 天且已不再是最新版本的 APK。已公开的首次安装版本按其独立发布周期维护。

## 自定义休息页背景

电视更新到 5.0.12 或更新版本后，在手机打开“我的 → 电视与连接设置 → 休息页背景”。两端同网并已开启直连时，可从系统照片选择器选择宽度超过 2048 像素、高度至少 1080 像素的横屏图。16:9 图片更容易完整显示。手机移除原有照片元数据后把图传给电视，电视校验完整文件再替换背景。图像保存在电视的应用私有目录，休息页保留半透明遮罩以便阅读。
