import SwiftUI

struct LocalNetworkView: View {
  @Environment(FamilyStore.self) private var store
  @State private var confirmDisconnect = false
  var body: some View {
    List {
      Section {
        Text(L10n.tr("在家更快，在外也能用")).font(.title2.bold())
        Text(L10n.tr("手机和电视连着同一个家用 Wi-Fi 时，可以直接沟通。在外面用手机流量时，就通过你选择的服务器联系电视。App 会自动选择，你不用手动切换。"))
      }
      if let device = store.selected {
        Section {
          LabeledContent(L10n.tr("当前电视"), value: device.label)
          Label(
            store.lan.localOnline
              ? L10n.tr("已直接连接电视") : store.lan.paired ? L10n.tr("已配对，等待在家连接") : L10n.tr("还没有开启直连"),
            systemImage: store.lan.localOnline ? "wifi" : "wifi.slash")
          if let receipt = store.lan.lastReceipt {
            LabeledContent(L10n.tr("电视当前反馈"), value: execution(receipt.execution_result))
          }
          Button(store.lan.paired ? L10n.tr("重新连接这部手机") : L10n.tr("开启这部手机的直连")) {
            Task { await store.pairLocal() }
          }.disabled(store.busy).accessibilityIdentifier("pairLocalTV")
          if store.lan.paired {
            Button(L10n.tr("关闭本机直连"), role: .destructive) { confirmDisconnect = true }.disabled(
              store.busy)
          }
          if store.busy { ProgressView(L10n.tr("正在连接…")) }
        } header: {
          Text(L10n.tr("这台电视的直连状态"))
        } footer: {
          Text(L10n.tr("首次开启时，手机和电视都需要联网，并允许本地网络访问。配对有效期最长30天；过期后重新连接即可。"))
        }
      }
      Section(L10n.tr("在家：直接发给电视")) {
        ConnectionRouteDiagram(direct: true)
        Text(L10n.tr("暂停、允许观看和规则调整先直接送到电视，通常更快。已完成配对后，外网暂时断开也能使用有效的直连授权。"))
        Text(L10n.tr("同一个 Wi-Fi 名称也可能有设备隔离。如果找不到电视，先确认不是访客网络，或让安装助手检查。"))
          .font(.subheadline).foregroundStyle(Color("SupportingText"))
      }
      Section(L10n.tr("在外：通过服务器联系")) {
        ConnectionRouteDiagram(direct: false)
        Text(L10n.tr("手机不在家，或没有直接连到电视时，操作会经过官方或自部署服务器。电视需要保持联网，可能会多等几秒。"))
        Text(L10n.tr("直连不代表数据只留在家里。账号、设置和观看记录仍会按你选择的服务同步；直连只是让操作更快送达。"))
          .font(.subheadline).foregroundStyle(Color("SupportingText"))
      }
      Section {
        DisclosureGroup(L10n.tr("用了什么技术？")) {
          Text(
            L10n.tr("App 通过 Bonjour（mDNS）发现同一网络里的电视，使用 TLS 加密连接并校验电视身份。每条操作带有这部手机的数字签名，电视确认授权后才执行。")
          )
          Text(L10n.tr("只有你配对过的这部手机能使用该授权。断网期间，电视可能还不知道你已在服务器撤销授权；重新联网后会再次核对。"))
        }
        Button(L10n.tr("打开本 App 设置")) {
          if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
          }
        }
        Text(L10n.tr("手机只在 App 打开时寻找电视，不会一直在后台扫描。拒绝本地网络权限后，仍可通过服务器操作。"))
          .font(.footnote).foregroundStyle(Color("SupportingText"))
      }
    }
    .navigationTitle(L10n.tr("局域网连接")).navigationBarTitleDisplayMode(.inline)
    .alert(L10n.tr("关闭这部手机的直连？"), isPresented: $confirmDisconnect) {
      Button(L10n.tr("关闭本机直连"), role: .destructive) { Task { await store.disconnectLocal() } }
      Button(L10n.tr("取消"), role: .cancel) {}
    } message: {
      Text(L10n.tr("关闭后，这部手机仍能通过服务器操作电视。其他手机不受影响。"))
    }
  }
  private func execution(_ value: String?) -> String {
    switch value {
    case "stopped": L10n.tr("视频已暂停")
    case "allowed": L10n.tr("可以继续观看")
    case "observing": L10n.tr("暂停功能还在设置中")
    case "failed": L10n.tr("电视还没完成操作，请让助手检查")
    case "superseded": L10n.tr("已按家长的最新设置更新")
    default: L10n.tr("正在等待电视回应")
    }
  }
}
