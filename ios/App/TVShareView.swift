import CoreImage.CIFilterBuiltins
import SwiftUI

struct TVShareView: View {
  @Environment(FamilyStore.self) private var store
  let deviceID: String
  @State private var code: TVShareCode?
  @State private var people = TVSharePeople(requests: [], members: [])
  @State private var working = false
  @State private var failure: String?
  @State private var confirmPerson: TVSharePeople.Request?
  var body: some View {
    List {
      Section {
        Text(L10n.tr("邀请家人一起管理这台电视")).font(.headline)
        Text(L10n.tr("让对方在观有度中点“添加电视”→“扫描分享码”。扫码后，需要你在这里确认。只分享这一台电视，其他电视不会共享。"))
        if let code {
          Text(code.label).font(.headline)
          if let image = qr(code.link) {
            Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
              .padding(16).background(.white).frame(maxWidth: 280)
              .frame(maxWidth: .infinity).accessibilityLabel(L10n.tr("这台电视的分享二维码"))
          }
          TimelineView(.periodic(from: .now, by: 1)) { context in
            Text(
              context.date.timeIntervalSince1970 * 1000 < code.expires_ms
                ? L10n.tr("二维码10分钟有效，过期后请重新生成。") : L10n.tr("二维码已过期，请重新生成。")
            )
            .font(.footnote).foregroundStyle(Color("SupportingText"))
          }
          ShareLink(L10n.tr("发送分享链接"), item: code.link)
        }
        Button(L10n.tr("生成新的分享码")) { Task { await generate() } }.disabled(working || store.demo)
        if store.demo { Text(L10n.tr("演示模式不会分享真实电视。")) }
        if working { ProgressView() }
        if let failure { Text(failure).foregroundStyle(Color("SupportingText")) }
      }
      Section(L10n.tr("等待你确认")) {
        if people.requests.isEmpty { Text(L10n.tr("还没有新的申请")) }
        ForEach(people.requests) { person in
          VStack(alignment: .leading, spacing: 8) {
            Text(person.username).font(.headline)
            HStack {
              Button(L10n.tr("同意管理")) { confirmPerson = person }
              Spacer()
              Button(L10n.tr("拒绝"), role: .destructive) {
                Task { await decide(person.id, approve: false) }
              }
            }.buttonStyle(.bordered).disabled(working)
          }
        }
      }
      Section(L10n.tr("共同管理的家人")) {
        if people.members.isEmpty { Text(L10n.tr("目前只有你能管理")) }
        ForEach(people.members) { member in
          HStack {
            Text(member.username)
            Spacer()
            Button(L10n.tr("取消共享"), role: .destructive) {
              Task { await perform("/admin/share/revoke", body: ["household_id": member.id]) }
            }.disabled(working)
          }
        }
        Text(L10n.tr("取消后，对方不能再通过服务器管理这台电视。已配对手机的本地授权会在电视联网同步后撤销。"))
          .font(.footnote).foregroundStyle(Color("SupportingText"))
      }
    }.navigationTitle(L10n.tr("分享此电视")).navigationBarTitleDisplayMode(.inline)
      .task {
        guard !store.demo else { return }
        await generate()
        while !Task.isCancelled {
          await refresh()
          do { try await Task.sleep(for: .seconds(5)) } catch { return }
        }
      }
      .alert(
        L10n.tr("允许这位家人管理？"),
        isPresented: Binding(
          get: { confirmPerson != nil }, set: { if !$0 { confirmPerson = nil } }
        ), presenting: confirmPerson
      ) { person in
        Button(L10n.tr("同意管理")) {
          Task { await decide(person.id, approve: true) }
          confirmPerson = nil
        }
        Button(L10n.tr("取消"), role: .cancel) { confirmPerson = nil }
      } message: { person in
        Text(person.username + "\n\n" + L10n.tr("对方可以查看这台电视的观看记录、修改规则、暂停和发放观看时间。请核对上方的家庭用户名。"))
      }
  }
  private func generate() async {
    guard let auth = store.auth, !working else { return }
    working = true
    defer { working = false }
    do {
      code = try await store.api.request(
        "/admin/share/create", auth: auth, device: deviceID, body: [:])
      failure = nil
    } catch { failure = L10n.message(for: error) }
  }
  private func refresh() async {
    guard let auth = store.auth, !working else { return }
    do {
      people = try await store.api.request("/admin/share/requests", auth: auth, device: deviceID)
      failure = nil
    } catch { failure = L10n.message(for: error) }
  }
  private func decide(_ id: String, approve: Bool) async {
    await perform(
      approve ? "/admin/share/approve" : "/admin/share/reject", body: ["request_id": id])
  }
  private func perform(_ path: String, body: [String: Any]) async {
    guard let auth = store.auth, !working else { return }
    working = true
    do {
      let _: SuccessResponse = try await store.api.request(
        path, auth: auth, device: deviceID, body: body)
      failure = nil
    } catch { failure = L10n.message(for: error) }
    working = false
    await refresh()
  }
  private func qr(_ text: String) -> UIImage? {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(text.utf8)
    guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
      let image = CIContext().createCGImage(output, from: output.extent)
    else { return nil }
    return UIImage(cgImage: image)
  }
}
