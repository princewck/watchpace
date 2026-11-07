import SwiftUI

struct TVUpdateView: View {
  @Environment(FamilyStore.self) private var store
  let deviceID: String
  @State private var release: TVRelease?
  @State private var checking = true
  @State private var transferring = false
  @State private var progress = 0.0
  @State private var status: String?
  @State private var failure: String?
  private var device: TVDevice? { store.devices.first { $0.id == deviceID } }
  var body: some View {
    List {
      Section {
        Label(device?.label ?? L10n.tr("电视"), systemImage: "tv")
        LabeledContent(L10n.tr("最新发布版本"), value: release?.version ?? "—")
      }
      if (device?.update_protocol_version ?? 0) < 1 {
        Section {
          Text(L10n.tr("这台电视尚未支持手机升级，需要先通过电脑安装一次带有升级功能的客户端。之后可在同一 Wi-Fi 下从这里发起更新。"))
          if let device, device.isOwner {
            NavigationLink(L10n.tr("打开安装引导")) { InstallationView(existingDevice: device) }
          }
        }
      } else if let release, (device?.client_version_code ?? 0) >= release.version_code {
        Section { Label(L10n.tr("电视已是最新发布版本"), systemImage: "checkmark.circle") }
      } else if release != nil {
        Section {
          Text(L10n.tr("手机先下载并校验安装包，再通过加密直连传给电视。最后请用遥控器确认安装；绑定和观看记录会保留。"))
          if !store.lan.isPaired(with: deviceID) {
            NavigationLink(L10n.tr("开启局域网直连")) { LocalNetworkView() }
          }
          Button(L10n.tr("下载并传送更新")) { Task { await transfer() } }
            .disabled(transferring || !store.lan.isPaired(with: deviceID))
          if transferring {
            if progress == 0 { ProgressView() } else { ProgressView(value: progress) }
          }
          if let status { Text(status).font(.subheadline) }
          if let failure { Text(failure).foregroundStyle(Color("SupportingText")) }
          Button(L10n.tr("检查升级结果")) {
            Task {
              await store.refresh()
              await checkRelease()
            }
          }.disabled(transferring)
        }
      } else {
        Section {
          if checking { ProgressView() }
          if let failure { Text(failure) }
          Button(L10n.tr("重新检查")) { Task { await checkRelease() } }.disabled(checking)
        }
      }
      Section {
        Text(
          L10n.tr(
            "如果电视提示不允许安装，请进入电视显示的权限页面，允许“电视时间”安装应用，然后返回确认。部分电视会限制此权限；此时请使用电脑安装引导。更新过程可能暂时中断观看。")
        )
        .font(.footnote).foregroundStyle(Color("SupportingText"))
      }
    }.navigationTitle(L10n.tr("电视客户端更新")).navigationBarTitleDisplayMode(.inline)
      .task {
        if store.selectedID != deviceID { await store.select(deviceID) }
        await checkRelease()
      }
      .interactiveDismissDisabled(transferring)
  }
  private func checkRelease() async {
    guard let auth = store.auth else {
      checking = false
      return
    }
    checking = true
    defer { checking = false }
    do {
      release = try await TVUpdatePackage.latest(api: store.api, auth: auth, device: deviceID)
      failure = nil
    } catch is CancellationError {
      return
    } catch {
      release = nil
      failure = L10n.tr("暂时无法下载电视更新，请稍后重试。")
    }
  }

  private func transfer() async {
    guard !transferring, !store.busy, !store.demo,
      store.selectedID == deviceID, let auth = store.auth, let release
    else { return }
    transferring = true
    store.busy = true
    failure = nil
    progress = 0
    defer {
      transferring = false
      store.busy = false
    }
    var downloading = true
    do {
      status = L10n.tr("正在验证手机并下载安装包…")
      let data = try await TVUpdatePackage.download(
        release: release, api: store.api, auth: auth, device: deviceID)
      downloading = false
      progress = 0
      status = L10n.tr("正在传送到电视…")
      let id = UUID().uuidString
      let revision = store.usage?.state.control_revision ?? 1
      _ = try await store.lan.sendUpdate(
        [
          "kind": "update_begin", "upload_id": id,
          "size": data.count, "sha256": release.sha256,
          "version_code": release.version_code,
        ], device: deviceID, revision: revision)
      for offset in stride(from: 0, to: data.count, by: 8192) {
        try Task.checkCancellation()
        let end = min(data.count, offset + 8192)
        let receipt = try await store.lan.sendUpdate(
          [
            "kind": "update_chunk", "upload_id": id, "offset": offset,
            "data": data.subdata(in: offset..<end).base64EncodedString(),
          ], device: deviceID, revision: revision)
        guard receipt.received >= end else { throw TVError.message(L10n.tr("更新传输未完成，请重试。")) }
        progress = Double(end) / Double(data.count)
        try await Task.sleep(for: .milliseconds(200))
      }
      _ = try await store.lan.sendUpdate(
        ["kind": "update_finish", "upload_id": id], device: deviceID, revision: revision)
      status = L10n.tr("安装包已送达，请在电视上确认安装。完成后点“检查升级结果”。")
    } catch is CancellationError {
      status = nil
    } catch {
      let description =
        downloading
        ? ((error as? TVError)?.localizedDescription ?? L10n.tr("暂时无法下载电视更新，请稍后重试。"))
        : L10n.tr("更新未完成，原客户端仍保留。请确认电视与手机连接同一 Wi-Fi，然后重试。")
      failure = description
      store.error = description
      status = nil
    }
  }
}
