import SwiftUI

struct InstallationChecksPanel: View {
  let health: InstallationHealth?
  let control: PlaybackState?
  let sending: Bool
  let resumedForTest: Bool
  let refresh: () async -> Void
  let pause: (Bool) async -> Void
  private var current: InstallationProgress { .next(health?.checks) }
  private let stages: [InstallationProgress] = [
    .connection, .permissions, .playback, .debugging, .reboot,
  ]

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      ForEach(stages, id: \.rawValue) { stage in
        VStack(alignment: .leading, spacing: 12) {
          HStack(alignment: .top, spacing: 10) {
            Image(systemName: passed(stage) ? "checkmark.circle.fill" : "circle")
              .foregroundStyle(passed(stage) ? Color("SuccessText") : Color.secondary)
            Text(title(stage)).font(stage == current ? .headline : .subheadline)
              .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Text(passed(stage) ? L10n.tr("通过") : stage == current ? L10n.tr("待完成") : L10n.tr("稍后"))
              .font(.footnote).foregroundStyle(Color("SupportingText"))
          }
          if stage == current { action(stage) }
        }
        if stage != .reboot { Divider() }
      }
    }.padding(20).background(.background, in: .rect(cornerRadius: 16))
    if current == .complete {
      Text(L10n.tr("全部检查已通过，点下方“下一步”即可。")).foregroundStyle(Color("SuccessText"))
    }
  }

  private func title(_ stage: InstallationProgress) -> String {
    switch stage {
    case .connection: L10n.tr("连接电视")
    case .permissions: L10n.tr("准备所需权限")
    case .playback: L10n.tr("测试暂停和继续播放")
    case .debugging: L10n.tr("关闭电视调试开关")
    case .reboot: L10n.tr("重启后仍能连接")
    case .complete: L10n.tr("配置完成")
    }
  }
  private func passed(_ stage: InstallationProgress) -> Bool {
    guard let c = health?.checks else { return false }
    switch stage {
    case .connection: return c.connected
    case .permissions: return c.permissions
    case .playback: return c.playback_test
    case .debugging: return c.adb_closed
    case .reboot: return c.rebooted
    case .complete: return health?.complete == true
    }
  }
  @ViewBuilder private func action(_ stage: InstallationProgress) -> some View {
    switch stage {
    case .connection:
      Text(L10n.tr("先让电脑助手完成安装。它说电视已连接后，点“检查电视连接”。"))
      checkButton(L10n.tr("检查电视连接"), id: "checkConnection")
    case .permissions:
      Text(L10n.tr("请截下这一页，发到电脑助手的聊天里，让它检查权限。切换页面不会取消安装。"))
      checkButton(L10n.tr("检查权限"), id: "checkPermissions")
    case .playback:
      if control?.paused == true {
        if InstallationProgress.pauseConfirmed(control) {
          Text(L10n.tr("视频已停止，电视可能显示休息页。确认没有视频声音后，点“允许继续播放”。"))
          FormActionButton(title: L10n.tr("允许继续播放"), busy: sending) { Task { await pause(false) } }
            .accessibilityIdentifier("installationResume")
        } else {
          Text(L10n.tr("正在等电视停止，通常十来秒。超过45秒仍未停，请把这一页截图发给电脑助手。"))
          checkButton(L10n.tr("检查是否已暂停"), id: "checkPause")
        }
      } else if resumedForTest && control?.status == "lock" {
        Text(
          control?.lock_reason == "daily_limit"
            ? L10n.tr("已解除暂停，但今天的观看时间已用完。请让电脑助手先确认测试安排。")
            : L10n.tr("已解除暂停，但现在仍是休息时间或还有其他限制。请让电脑助手先确认测试安排。"))
        checkButton(L10n.tr("重新检查观看状态"), id: "checkViewingRules")
      } else if resumedForTest {
        Text(L10n.tr("休息页关闭后，请用电视遥控器重新播放视频。有视频画面和声音后，点“视频已播放，检查结果”。"))
        FormActionButton(title: L10n.tr("视频已播放，检查结果"), busy: sending) { Task { await refresh() } }
          .accessibilityIdentifier("checkPlayback")
        Button(L10n.tr("重新测试暂停")) { Task { await pause(true) } }.disabled(sending)
      } else {
        Text(L10n.tr("手机留在这里。先用电视遥控器打开视频并播放，再点下面的“暂停电视”。"))
        FormActionButton(title: L10n.tr("暂停电视"), busy: sending) { Task { await pause(true) } }
          .accessibilityIdentifier("installationPause")
      }
    case .debugging:
      Text(L10n.tr("按电脑助手给出的电视菜单路径，关闭它指出的调试开关。只操作那个开关；关好后，点“已关闭，检查一下”。"))
      checkButton(L10n.tr("已关闭，检查一下"), id: "checkDebugging")
    case .reboot:
      Text(L10n.tr("在电视系统菜单里选择“重启”。回到电视桌面后，点“电视已重启，检查连接”。找不到重启入口时，请让电脑助手指路。"))
      checkButton(L10n.tr("电视已重启，检查连接"), id: "checkReboot")
    case .complete: EmptyView()
    }
  }
  private func checkButton(_ label: String, id: String) -> some View {
    FormActionButton(title: label, busy: sending) { Task { await refresh() } }
      .accessibilityIdentifier(id)
  }
}
