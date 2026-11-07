import CryptoKit
import PhotosUI
import SwiftUI

struct TVRestPhotoView: View {
  @Environment(FamilyStore.self) private var store
  let deviceID: String
  @State private var selection: PhotosPickerItem?
  @State private var checking = true
  @State private var reachable = false
  @State private var progress: Double?
  @State private var message: String?
  private var supported: Bool {
    (store.devices.first { $0.id == deviceID }?.client_version_code ?? 0) >= 18
  }

  var body: some View {
    List {
      Section {
        if !supported {
          Text(L10n.tr("请先更新电视客户端，再设置休息页背景。"))
          NavigationLink(L10n.tr("电视客户端更新")) { TVUpdateView(deviceID: deviceID) }
        } else if checking {
          ProgressView(L10n.tr("正在检查电视直连…"))
        } else if !reachable {
          Text(L10n.tr("请将手机和电视连接到同一 Wi-Fi，并开启这台电视的局域网直连。"))
          if !store.lan.isPaired(with: deviceID) {
            NavigationLink(L10n.tr("开启局域网直连")) { LocalNetworkView() }
          }
          Button(L10n.tr("重新检查")) { Task { await check() } }
        } else {
          PhotosPicker(selection: $selection, matching: .images) {
            Label(L10n.tr("从照片选择"), systemImage: "photo.on.rectangle")
          }.disabled(progress != nil)
          Text(L10n.tr("请选择宽度超过 2048 像素、高度至少 1080 像素的横屏照片，推荐 16:9。"))
            .font(.footnote)
        }
        if let progress { ProgressView(value: progress) }
        if let message { Text(message) }
      }
    }
    .navigationTitle(L10n.tr("休息页背景"))
    .navigationBarTitleDisplayMode(.inline)
    .task { await check() }
    .task(id: selection) { if let selection { await transfer(selection) } }
    .interactiveDismissDisabled(progress != nil)
  }

  private func check() async {
    checking = true
    defer { checking = false }
    if store.selectedID != deviceID { await store.select(deviceID) }
    reachable = false
    guard supported, store.lan.isPaired(with: deviceID) else { return }
    let revision = store.usage?.state.control_revision ?? 1
    for attempt in 0..<2 {
      if attempt > 0 { try? await Task.sleep(for: .milliseconds(800)) }
      guard !Task.isCancelled else { return }
      if await store.lan.refreshState(device: deviceID, revision: revision) != nil {
        reachable = true
        return
      }
    }
  }

  private func transfer(_ item: PhotosPickerItem) async {
    guard reachable, progress == nil, !store.busy, store.selectedID == deviceID else { return }
    progress = 0
    message = nil
    store.busy = true
    defer {
      progress = nil
      store.busy = false
      selection = nil
    }
    var sending = false
    do {
      guard let original = try await item.loadTransferable(type: Data.self) else {
        throw TVError.message(L10n.tr("无法读取这张照片。"))
      }
      let data = try await Task.detached(priority: .userInitiated) {
        try RestPhotoPackage.prepare(original)
      }.value
      sending = true
      let id = UUID().uuidString
      let revision = store.usage?.state.control_revision ?? 1
      let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
      _ = try await store.lan.sendUpdate(
        ["kind": "photo_begin", "upload_id": id, "size": data.count, "sha256": hash],
        device: deviceID, revision: revision)
      for offset in stride(from: 0, to: data.count, by: 8192) {
        try Task.checkCancellation()
        let end = min(data.count, offset + 8192)
        let receipt = try await store.lan.sendUpdate(
          [
            "kind": "photo_chunk", "upload_id": id, "offset": offset,
            "data": data.subdata(in: offset..<end).base64EncodedString(),
          ],
          device: deviceID, revision: revision)
        guard receipt.received >= end else { throw URLError(.cannotWriteToFile) }
        progress = Double(end) / Double(data.count)
        try await Task.sleep(for: .milliseconds(200))
      }
      let receipt = try await store.lan.sendUpdate(
        ["kind": "photo_finish", "upload_id": id], device: deviceID, revision: revision)
      guard receipt.status == "saved" else { throw URLError(.cannotWriteToFile) }
      message = L10n.tr("电视已保存休息页背景。")
    } catch let error as TVError where !sending {
      message = L10n.message(for: error)
    } catch {
      message = L10n.tr("照片未传送成功，请检查 Wi-Fi 后重试。")
    }
  }
}
