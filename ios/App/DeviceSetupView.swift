import SwiftUI

struct DeviceSetupView: View {
  @Environment(FamilyStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  let deviceID: String
  @State private var confirmRemove = false
  private var device: TVDevice? { store.devices.first { $0.id == deviceID } }
  var body: some View {
    List {
      if let device {
        Section {
          Label(device.label, systemImage: "tv")
          Text(
            device.last_heartbeat_ms == nil
              ? L10n.tr("等待电视首次连接") : device.isOnline() ? L10n.tr("最近在线") : L10n.tr("未连接"))
          if device.last_heartbeat_ms == nil {
            Text(L10n.tr("安装尚未完成。收到电视上报后，才会显示观看状态。")).foregroundStyle(Color("SupportingText"))
          }
        }
        if device.isOwner {
          Section {
            NavigationLink(device.needsInstallation ? L10n.tr("继续安装") : L10n.tr("检查或修复连接")) {
              InstallationView(existingDevice: device)
            }.accessibilityIdentifier("resumeInstallation")
          }
          Section { NavigationLink(L10n.tr("分享此电视")) { TVShareView(deviceID: device.id) } }
        }
        if !store.demo {
          Section {
            NavigationLink(L10n.tr("电视客户端更新")) { TVUpdateView(deviceID: deviceID) }
            NavigationLink(L10n.tr("休息页背景")) { TVRestPhotoView(deviceID: deviceID) }
          }
          Section {
            Button(device.isOwner ? L10n.tr("移除电视") : L10n.tr("退出共享"), role: .destructive) {
              confirmRemove = true
            }.disabled(
              store.busy
            )
            .accessibilityIdentifier("removeDevice")
          } footer: {
            Text(
              device.isOwner
                ? L10n.tr("移除后，旧连接凭证立即失效。之后可以重新添加这台电视。") : L10n.tr("退出只取消你自己的管理权限，不影响电视和其他家人。"))
          }
        }
      }
    }
    .navigationTitle(L10n.tr("电视与连接设置")).navigationBarTitleDisplayMode(.inline)
    .confirmationDialog(
      device?.isOwner == false ? L10n.tr("退出这台电视的共享？") : L10n.tr("移除这台电视？"),
      isPresented: $confirmRemove, titleVisibility: .visible
    ) {
      Button(device?.isOwner != false ? L10n.tr("移除电视") : L10n.tr("退出共享"), role: .destructive) {
        guard let device else { return }
        Task { if await store.removeDevice(device) { dismiss() } }
      }
      Button(L10n.tr("取消"), role: .cancel) {}
    } message: {
      Text(
        device?.isOwner == false
          ? L10n.tr("退出只取消你自己的管理权限，不影响电视和其他家人。") : L10n.tr("这台电视的绑定和观看记录将被移除，家庭账号保留。电视本机的软件不会自动卸载。")
      )
    }
  }
}
