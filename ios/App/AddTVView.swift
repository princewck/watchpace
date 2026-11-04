import SwiftUI

struct AddTVView: View {
  @Environment(FamilyStore.self) private var store
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        Text(L10n.tr("你想怎么添加？")).font(.title2.bold())
        HStack(alignment: .top, spacing: 12) {
          NavigationLink {
            JoinSharedTVView()
          } label: {
            choice("OnboardingScan", L10n.tr("扫描分享码"), L10n.tr("家人已安装好，邀请你一起管理。"))
          }.accessibilityIdentifier("scanSharedTV")
          NavigationLink {
            InstallationView()
          } label: {
            choice("OnboardingNewTV", L10n.tr("安装新电视"), L10n.tr("第一次使用，跟着引导完成安装。"))
          }.accessibilityIdentifier("initializeNewTV")
        }.buttonStyle(.plain)
        let pending = store.devices.filter { $0.isOwner && $0.needsInstallation }
        if !pending.isEmpty {
          Text(L10n.tr("继续安装这台电视")).font(.headline)
          ForEach(pending) { device in
            NavigationLink {
              InstallationView(existingDevice: device)
            } label: {
              HStack {
                Label(device.label, systemImage: "tv")
                Spacer()
                Text(L10n.tr("继续安装"))
                Image(systemName: "chevron.right").font(.caption)
              }.padding().background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
            }.buttonStyle(.plain)
          }
        }
      }.padding(20)
    }.navigationTitle(L10n.tr("添加电视")).navigationBarTitleDisplayMode(.inline)
  }
  private func choice(_ image: String, _ title: String, _ detail: String) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Image(image).resizable().scaledToFit().accessibilityHidden(true)
      Text(title).font(.headline).foregroundStyle(.primary)
      Text(detail).font(.subheadline).foregroundStyle(Color("SupportingText"))
        .fixedSize(horizontal: false, vertical: true)
    }.padding(12).frame(maxWidth: .infinity, alignment: .topLeading)
      .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
  }
}
