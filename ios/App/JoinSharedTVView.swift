import SwiftUI

struct JoinSharedTVView: View {
  @Environment(FamilyStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  var initialLink: String = ""
  @State private var link = ""
  @State private var invite: TVShareLink?
  @State private var request: TVShareRequest?
  @State private var scanning = false
  @State private var signingIn = false
  @State private var working = false
  @State private var failure: String?
  var body: some View {
    List {
      Section {
        Text(L10n.tr("先让家人分享这台电视")).font(.headline)
        Text(L10n.tr("对方打开“我的”→选择那台电视→“分享此电视”，你再扫描显示的二维码。无需重新安装电视端。"))
        Button(L10n.tr("扫描二维码"), systemImage: "qrcode.viewfinder") { scanning = true }
          .disabled(store.demo || working)
        TextField(L10n.tr("也可以粘贴分享链接"), text: $link, axis: .vertical)
          .textInputAutocapitalization(.never).autocorrectionDisabled()
          .onChange(of: link) { _, _ in
            invite = nil
            request = nil
            failure = nil
          }
        Button(L10n.tr("识别分享链接")) { parse() }.disabled(link.isEmpty || working || store.demo)
        if store.demo { Text(L10n.tr("演示模式不会加入真实电视。")) }
      }
      if let invite {
        Section(L10n.tr("确认来自哪项服务")) {
          Text(invite.origin.absoluteString).font(.callout).textSelection(.enabled)
          if store.auth?.origin != invite.origin {
            Text(L10n.tr("分享链接与当前登录的服务不同。请先核对地址，再登录这个服务的家庭账号；现有账号的密码不会自动发送过去。"))
            Button(L10n.tr("登录此服务")) { signingIn = true }
          } else if request == nil {
            Text(L10n.tr("申请后，对方需要核对你的家庭用户名并同意，你才可以管理这台电视。"))
            Button(L10n.tr("申请共同管理")) { Task { await claim(invite) } }.disabled(working)
          }
        }
      }
      if let request {
        Section(request.label) {
          switch request.status {
          case "approved":
            Label(L10n.tr("对方已同意，可以管理了"), systemImage: "checkmark.circle.fill")
            Button(L10n.tr("查看这台电视")) {
              Task {
                await store.refresh()
                await store.select(request.device)
                dismiss()
              }
            }
          case "pending":
            ProgressView(L10n.tr("等待对方确认"))
            Text(L10n.tr("请让对方打开这台电视的“分享此电视”，在“等待你确认”中同意你的申请。"))
            Button(L10n.tr("重新检查")) { Task { await refreshRequest() } }.disabled(working)
          case "rejected": Text(L10n.tr("对方没有同意。请先与对方确认，需要时重新分享。"))
          case "revoked": Text(L10n.tr("共享已取消。需要时，请让对方重新分享。"))
          default: Text(L10n.tr("申请已过期，请让对方重新分享后再扫码。"))
          }
        }
      }
      if working { Section { ProgressView() } }
      if let failure { Section { Text(failure).foregroundStyle(Color("SupportingText")) } }
    }.navigationTitle(L10n.tr("从分享码添加")).navigationBarTitleDisplayMode(.inline)
      .onAppear {
        if link.isEmpty && !initialLink.isEmpty {
          link = initialLink
          parse()
        }
      }
      .sheet(isPresented: $scanning) {
        NavigationStack {
          QRScannerView { value in
            link = value
            scanning = false
            parse()
          }
          .navigationTitle(L10n.tr("扫描分享码"))
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button(L10n.tr("取消")) { scanning = false }
            }
          }
        }
      }
      .sheet(isPresented: $signingIn) {
        LoginView(initialOrigin: invite?.origin.absoluteString)
      }
      .task(id: request?.request_id) {
        guard request?.status == "pending" else { return }
        while !Task.isCancelled && request?.status == "pending" {
          do { try await Task.sleep(for: .seconds(3)) } catch { return }
          await refreshRequest()
        }
      }
  }
  private func parse() {
    do {
      invite = try TVShareLink(link.trimmingCharacters(in: .whitespacesAndNewlines))
      failure = nil
    } catch {
      invite = nil
      failure = L10n.message(for: error)
    }
  }
  private func claim(_ invite: TVShareLink) async {
    guard !working, let auth = store.auth, auth.origin == invite.origin else { return }
    working = true
    defer { working = false }
    do {
      let value: TVShareRequest = try await store.api.request(
        "/admin/share/request", auth: auth, body: ["code": invite.code])
      guard store.auth?.token == auth.token else { return }
      request = value
      failure = nil
    } catch { failure = L10n.message(for: error) }
  }
  private func refreshRequest() async {
    guard !working, let auth = store.auth, auth.origin == invite?.origin, let request else {
      return
    }
    working = true
    defer { working = false }
    do {
      let value: TVShareRequest = try await store.api.request(
        "/admin/share/status", auth: auth, query: ["request": request.request_id])
      guard store.auth?.token == auth.token else { return }
      self.request = value
      failure = nil
    } catch { failure = L10n.message(for: error) }
  }
}
