import Foundation

extension FamilyStore {
  @discardableResult func syncSubscriptions(
    _ receipts: [String], signedAppTransaction: String? = nil
  ) async -> Set<String> {
    guard !demo, let auth, capabilities?.paid_history == true else { return [] }
    let household = billingHouseholdID
    let device = selectedID
    let previouslyActive = premiumActive
    var acknowledged = Set<String>()
    var failed = false
    func sameContext() -> Bool {
      self.auth?.token == auth.token && !demo && billingHouseholdID == household
        && selectedID == device
    }
    for receipt in receipts {
      guard sameContext(), !Task.isCancelled else { return acknowledged }
      do {
        var body = ["signed_transaction": receipt]
        if let signedAppTransaction { body["signed_app_transaction"] = signedAppTransaction }
        let value: CloudSubscription = try await api.request(
          "/admin/subscription", auth: auth, device: device, body: body)
        guard sameContext() else { return [] }
        if let id = value.transaction_id { acknowledged.insert(id) }
        premium = value
      } catch { failed = true }
    }
    guard sameContext(), !Task.isCancelled else { return acknowledged }
    do {
      let status: CloudSubscription = try await api.request(
        "/admin/subscription", auth: auth, device: device)
      guard sameContext() else { return acknowledged }
      premium = status
    } catch { failed = true }
    guard sameContext() else { return acknowledged }
    subscriptionSyncError = failed ? L10n.tr("订阅同步尚未完成，请稍后重试。") : nil
    if !previouslyActive, premiumActive { await refresh() }
    return acknowledged
  }
}
