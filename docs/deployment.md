# 使用 SQLite 部署

同一个 iOS App 可连接官方服务或你的自部署服务。电视端也使用同一份 APK，服务地址由本次手机安装页指定。各个服务的账户、数据和登录凭证相互独立。

当前 iOS App 处于预发布，商店下载链接尚未提供；维护者可按开发说明构建测试。正式发布后，家长无需自行编译。

## 准备与启动

安装 Node.js 24 和 Nginx，准备具有有效 HTTPS 证书的域名。进入仓库的 `server/`，按 README 安装依赖并构建。复制 `deploy/self-hosted.env.example` 为 `.env`：

- `PUBLIC_ORIGIN`：自己的完整 HTTPS 地址，不带路径和末尾斜线。
- `SQLITE_PATH`：运行账号可写的数据库文件，例如 `/opt/watchpace/runtime/familytv.sqlite`。
- `STATIC_ROOT`：本机 `server/public` 的绝对路径。
- `PORT`：默认 3001，只监听 `127.0.0.1`。
- `OFFICIAL_CLOUD=false`：自部署包含 30 天记录，无需 Apple 或支付配置。

先创建运行目录并将其交给最终运行服务的账号写入，再用该账号初始化。初始化只创建数据库结构，不生成默认账户；首次家庭由手机注册创建。

环境文件应设为 `chmod 600 .env`，运行目录设为 `chmod 700`。执行：

```sh
node --env-file=.env node-runtime/init.mjs
node --env-file=.env dist/node-server.mjs
```

初始化可以重复运行，不会覆盖已有家庭。日志只报告运行状态，不输出密码、安装码或设备令牌。检查 `http://127.0.0.1:3001/healthz` 返回 `status: ok`。

## HTTPS 与常驻运行

`server/deploy/nginx-gateway.conf` 是官方域名的反向代理模板。替换所有 `tv.chengkai.wang` 为自己的域名，填写自己的证书路径，并核对代理端口。通过 `nginx -t` 后重载 Nginx。不要开放 3001 公网端口。证书可由 Certbot 管理：

```sh
sudo apt-get install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d 你的实际域名 --redirect
```

不要直接加载尚不存在证书的 443 模板；首次先使用本域名的 80 端口站点取得证书，再配置 HTTPS 代理。

常驻运行可使用 `server/deploy/familytv-gateway.service`。创建专用系统账号，并根据实际位置修改 `WorkingDirectory`、`EnvironmentFile`、`ExecStart`、`ReadWritePaths`。Node 可执行文件位置以 `command -v node` 为准。环境文件仍设为 600，由 systemd 读取。复制到 `/etc/systemd/system/` 后运行 `systemctl daemon-reload` 和 `systemctl enable --now familytv-gateway`。

## 安装文件

手机安装页直接引用官方 Cloudflare 下载站，因此自部署服务不必保存 ZIP 或 APK；健康检查和家庭注册均不依赖这些文件。仅在开发 App、运行版本检查或需要镜像文件时，在仓库根目录执行 `python3 scripts/check-distribution.py --fetch`，按固定 SHA-256 下载到 `server/public/downloads/`。无需自行构建或签名 APK，下载域名不影响你的电视服务 endpoint。

自行发布修改过的客户端时，需要自己的签名密钥和新版本号，参见开发说明；不能覆盖已有不可变发行文件。

## 备份与恢复

```sh
node --env-file=.env node-runtime/backup.mjs /私有备份目录/familytv.sqlite
```

脚本使用 SQLite 在线备份接口，包含 WAL 中尚未合并的数据；备份包含敏感账户与设备数据，应加密保管并定期演练恢复。不要直接复制运行中的单个 `.sqlite` 文件。

恢复时先停止服务，把当前数据库及其 `-wal`、`-shm` 文件移到私有备份目录，再将备份放到 `SQLITE_PATH`，恢复运行账号的所有权与权限。服务停止时应移走旧 WAL，避免与恢复后的数据库混用。

另应私有备份 `.env`、域名与证书续期配置。同一服务地址和兼容代码版本下，数据库内的家庭、会话和设备绑定可继续使用，手机和电视自身的私有令牌仍需保留。迁移域名可能需要重新登录或配置。

重启前检查 SQLite 完整性，结果应为 `ok`：

```sh
node --input-type=module -e 'import {DatabaseSync} from "node:sqlite";const d=new DatabaseSync(process.argv[1]);console.log(d.prepare("PRAGMA integrity_check").get());d.close()' 数据库文件路径
```

再确认 HTTPS `/healthz` 正常、已有家庭可登录，以及电视产生新的真实心跳。不要以脚本发送假心跳代替真机检查。

## 容量

默认一个 Node 进程、一个 SQLite 文件，适合小型家庭部署。每台电视约每 10 秒上报一次；100 台在线电视约产生每秒 10 次心跳，另加手机请求。吞吐量受磁盘、共享负载和网络影响，不把本地微基准当作公网容量保证。每个公网 IP 另有接口限流，集中部署时应评估 NAT 下的合计请求量。
