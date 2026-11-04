import SwiftUI

struct ConnectionRouteDiagram: View {
  let direct: Bool
  var body: some View {
    HStack(spacing: 8) {
      node("iphone", L10n.tr("手机"))
      Image(systemName: "arrow.right").foregroundStyle(.secondary).accessibilityHidden(true)
      node(direct ? "wifi" : "cloud", direct ? L10n.tr("家里 Wi-Fi") : L10n.tr("互联网"))
      Image(systemName: "arrow.right").foregroundStyle(.secondary).accessibilityHidden(true)
      node("tv", L10n.tr("电视"))
    }.frame(maxWidth: .infinity).padding(.vertical, 14)
      .accessibilityElement(children: .combine)
  }
  private func node(_ symbol: String, _ label: String) -> some View {
    VStack(spacing: 8) {
      Image(systemName: symbol).font(.title2).foregroundStyle(direct ? .blue : .purple)
        .frame(height: 32).accessibilityHidden(true)
      Text(label).font(.caption).multilineTextAlignment(.center)
    }.frame(maxWidth: .infinity)
  }
}
