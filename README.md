# Watchpace · 观有度

让电视时间有约定。家长用 iPhone 设置每日观看额度、休息时段和临时观看时间，Android TV 客户端在本机执行规则。

电视端开源免费，服务端可自行部署。正式发布后，普通用户使用同一个 iOS App，在登录前选择官方服务或填写自部署 HTTPS 地址，无需自行编译。官方云服务的订阅用于支持云端存储与服务器运行，自部署不需要 Apple 开发者账号或订阅配置。

当前为预发布版本，尚无 App Store 下载入口；维护者可按开发说明构建测试。商店链接将在正式发布后补充。

## 使用方式

1. 在 App 中选择服务并创建家庭。官方服务为 `https://tv.chengkai.wang`；自部署账户与官方账户相互独立。
2. 打开“添加电视 → 安装新电视”，把显示**完整 endpoint、设备标识和安装码**的页面交给信任的电脑端 Agent。
3. 按提示授权安装和必要权限。收到电视真实上报才显示已连接；播放、权限、关闭 ADB 和完整重启检查全部通过，才算配置完成。

安装中断后，在“我的 → 家庭设备 → 对应电视”继续检查、重新生成安装码或移除电视。重生成会撤销旧连接凭证。安装码有效 15 分钟、只能领取一次；领取后码过期不会让已连接电视掉线。

家人已安装好的电视可以共享：原家长在“我的 → 家庭设备 → 对应电视 → 分享此电视”出示二维码，另一位家长选择“添加电视 → 扫描分享码”。原家长核对申请人的用户名并同意后，对方才能查看记录、修改规则和管理观看时间。分享只包含这一台电视，随时可取消。二维码有效10分钟；扫码本身不会获得管理权限。

多台电视可在“今天”“规则”“记录”页切换；只有一台时隐藏选择框。规则、暂停和临时观看时间分别作用于当前电视。

安装说明：[电视安装技能](installer/family-tv-setup/SKILL.md)。使用前了解[权限及产品范围](docs/project-scope.md)和[休息安排建议](docs/responsible-use.md)。只在家长授权的自有设备上安装；系统拒绝安装或授权时停止。

## 自行部署

后端只需 **Node.js 24 + SQLite**，不依赖 Redis、MySQL、Cloudflare 或反向隧道。公网 HTTPS 可交给 Nginx。部署后，在同一个 App 中选择“自定义部署”，填写你的地址。

从仓库根目录开始：

```sh
cd server
npm ci --ignore-scripts
npm run build:node
cp deploy/self-hosted.env.example .env
# 编辑 .env，填写域名和适合本机的数据库、静态目录路径
node --env-file=.env node-runtime/init.mjs
node --env-file=.env dist/node-server.mjs
```

然后配置 HTTPS 反向代理。完整步骤、常驻运行、备份和恢复见[部署说明](docs/deployment.md)。自部署默认包含 180 天记录，不需要 Apple 签名密钥、商店账号或支付配置。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `ios/` | SwiftUI 家长 App；中文、英文、韩文、日文 |
| `android/` | Android TV 本地执行、离线规则、开机恢复与局域网控制 |
| `server/` | HTTP 接口、SQLite、家庭隔离、测试及部署模板 |
| `installer/` | Agent 安装技能、权限配置工具和发行清单 |
| `scripts/` | 版本与下载检查、公开发布检查 |
| `docs/` | 使用范围、部署、开发和协议说明 |

本仓库只包含家长管理功能：不提供播放器、节目、直播源、视频聚合、桌面替换、系统精简或安装限制绕过工具。没有包含旧项目历史、真实家庭数据、调试日志、证书私钥或签名安装包。

## 开发与发布

```sh
cd server && npm test
cd .. && python3 scripts/test-distribution.py
python3 scripts/check-distribution.py --fetch --online
python3 scripts/check-project.py
```

官方安装 ZIP 与 APK 由 Cloudflare Static Assets 托管，账号、配置和心跳走官方网关。下载域名不是设备连接的 endpoint。版本门禁分别校验这两类地址，避免改了网关却误连下载站，也避免发布新版本后手机仍引用旧文件。

代码按职责拆分，手写代码单文件不超过 500 行；锁文件和 Xcode 生成文件不受此限制。修改方式见 [CONTRIBUTING](CONTRIBUTING.md)，客户端构建见[开发说明](docs/development.md)。

采用 [MIT License](LICENSE)。第三方依赖及测试素材保留各自许可，见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。欢迎交流、反馈和贡献。
