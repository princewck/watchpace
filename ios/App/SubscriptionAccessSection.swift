import SwiftUI

/// History authorization and the actual Apple subscription are separate facts.
struct SubscriptionAccessSection: View {
  @Environment(FamilyStore.self) private var store
  var body: some View {
    Section(L10n.tr("订阅与历史权限")) {
      LabeledContent(
        L10n.tr("Apple 订阅"), value: store.premiumActive ? L10n.tr("订阅有效") : L10n.tr("未订阅"))
      LabeledContent(
        L10n.tr("历史查看"),
        value: store.capabilities?.history_access == true
          ? L10n.tr("维护者已授权") : store.premiumActive ? L10n.tr("订阅已授权") : L10n.tr("仅当天"))
      if store.capabilities?.history_access == true {
        Text(L10n.tr("维护者权限允许查看历史，不代表已购买 Apple 订阅。你仍可正常测试购买与恢复。"))
          .font(.footnote).foregroundStyle(Color("SupportingText"))
      }
      NavigationLink(L10n.tr("查看订阅")) { SubscriptionView() }
    }
  }
}
