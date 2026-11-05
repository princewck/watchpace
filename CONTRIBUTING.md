# 贡献指南

欢迎提出清楚描述场景的问题或 Pull Request。公开反馈只附脱敏数据，不上传家庭密码、恢复码、安装截图中的完整安装码、设备令牌、数据库或私钥。

变更请说明触发场景、修改后的行为和验证结果。功能变化应有对应的行为测试；纯文案和样式修改做针对性验证即可，不编写重复实现的测试。单个手写代码文件最多 500 行，过长时按职责拆分，不用压行或删除必要说明凑数。

提交前执行本文末尾的检查。JavaScript 与 Java 使用项目锁定的 Prettier 工具格式化。Swift 使用 Xcode 的 `swift-format`；生成的 `ReleaseDownloads.swift` 由脚本维护，不手改。锁文件、Xcode 生成文件和测试 fixture 保留来源。

请保持项目范围：只做家长授权的观看时间管理。新增安装流程不得禁用系统服务、绕过签名或厂商安装验证，不提供节目源、播放器安装或桌面接管功能。扩展题库或交互时先讨论有版本号的协议与服务端验证，不能信任网页自行声明解锁成功。

服务端启动、迁移、备份必须有可执行步骤；安装失败、重试和撤销路径同样需要说明。维护者不会要求提交 Apple 登录凭证或部署账号的长期密钥。

## 提交前检查

在仓库根目录运行：

```sh
npm --prefix server test
npm --prefix server run lint
npm --prefix server run format:check
python3 scripts/test-distribution.py
python3 scripts/check-distribution.py --fetch --online
python3 scripts/check-project.py
```

新增或修改界面时同步检查英语、简体中文、日语、韩语。产品截图应来自实际界面，使用演示或合成数据，不包含真实家庭信息；按语言放入 `docs/screenshots/`，并在相应 README 中注明演示数据。

## 项目目录

| 目录 | 内容 |
| --- | --- |
| `ios/` | SwiftUI 家长 App |
| `android/` | Android TV 客户端 |
| `server/` | 接口、SQLite 数据库和部署模板 |
| `installer/` | 安装引导、工具和发行清单 |
| `scripts/` | 发行校验和公开发布检查 |
| `docs/` | 使用、部署和开发文档 |
