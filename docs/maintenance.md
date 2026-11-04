# 停用与撤销权限

家长不再使用时，应先停用电视客户端，再在手机移除绑定。仅删除云端绑定，不能保证电视立即停止执行本机缓存规则。

1. 家长用遥控器重新开启 ADB 并允许自己的电脑。具体机型路径见[安装指南](../installer/family-tv-setup/references/install.md#3-打开开发者选项和-adb)。
2. 在安装工具目录运行 `python3 scripts/native-manage.py stop --tv 电视IP:端口`，再运行同地址的 `status`。
3. 确认 `enabled=false`、`native_service_running=false`、`accessibility_bound=false`，其他无障碍服务与安装前备份一致。未确认就保留未完成状态，不宣称已经停用。
4. 若家长要求撤销授予的权限，由助手逐项执行下面命令；它们只作用于本应用。`POST_NOTIFICATIONS` 仅在 Android 13 及以上处理，旧系统跳过。

```sh
adb -s 电视IP:端口 shell pm revoke org.example.tvchallenge android.permission.DUMP
adb -s 电视IP:端口 shell pm revoke org.example.tvchallenge android.permission.WRITE_SECURE_SETTINGS
adb -s 电视IP:端口 shell dumpsys deviceidle whitelist -org.example.tvchallenge
adb -s 电视IP:端口 shell cmd appops set org.example.tvchallenge RUN_IN_BACKGROUND default
adb -s 电视IP:端口 shell cmd appops set org.example.tvchallenge RUN_ANY_IN_BACKGROUND default
```

Android 12 及以上另将本应用 `SCHEDULE_EXACT_ALARM` 操作恢复为 `default`，Android 13 及以上另撤销本应用 `android.permission.POST_NOTIFICATIONS`。逐条核对命令结果，不把不支持的权限当作成功。只重置本应用，不使用全局权限重置。

完成后，在手机移除电视绑定。电视本机 APK 和私有配置仍保留；卸载需另获家长明确同意。最后关闭 USB／网络调试并撤销调试授权，核对调试端口已关闭；若 USB 网卡因调试断电，重新插拔并确认网络恢复。
