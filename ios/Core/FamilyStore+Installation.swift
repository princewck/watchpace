import Foundation

extension FamilyStore {
  func prepareInstallation(device: String? = nil, restart: Bool = false) async {
    guard !busy else { return }
    if !restart, let setupTicket, !setupTicket.expired,
      device == nil || setupTicket.device == device
    {
      return
    }
    refreshVersion += 1
    busy = true
    defer { busy = false }
    do {
      if demo {
        setupTicket = InstallationTicket(
          code: "DEMO1234DEMO5678", device: "demo-install", label: L10n.tr("新电视"),
          origin: L10n.tr("演示环境 · 不可用于真实安装"),
          expires_ms: Date.now.addingTimeInterval(900).timeIntervalSince1970 * 1000)
      } else {
        guard let auth else { return }
        var body: [String: Any] = ["label": L10n.tr("家庭电视")]
        if let device {
          body["device"] = device
        } else if let setupTicket, setupTicket.origin == auth.origin.absoluteString {
          body["device"] = setupTicket.device
        }
        let path = restart ? "/admin/installation_restart" : "/admin/installation_ticket"
        let ticket: InstallationTicket = try await api.request(
          path, auth: auth, device: restart ? (device ?? setupTicket?.device) : nil, body: body)
        setupTicket = ticket
      }
    } catch { self.error = L10n.message(for: error) }
  }
  func removeDevice(_ device: TVDevice) async -> Bool {
    guard !busy, !demo, let auth else { return false }
    busy = true
    do {
      let _: SuccessResponse = try await api.request(
        "/admin/device_remove", auth: auth, device: device.id, body: [:])
      if setupTicket?.device == device.id { setupTicket = nil }
      if selectedID == device.id { selectedID = nil }
      busy = false
      await refresh()
      return true
    } catch {
      busy = false
      self.error = L10n.message(for: error)
      return false
    }
  }
  func installationHealth(device: String) async throws -> InstallationHealth {
    guard !demo, let auth else { throw TVError.message(L10n.tr("演示模式不会连接真实电视。")) }
    return try await api.request("/admin/installation_status", auth: auth, device: device)
  }
  func installationControl(device: String) async throws -> PlaybackState {
    if demo, let state = usage?.state { return state }
    if lan.isPaired(with: device),
      let receipt = await lan.refreshState(
        device: device, revision: usage?.state.control_revision ?? 1), let state = receipt.state
    {
      return state
    }
    guard let auth else { throw TVError.message(L10n.tr("请先登录家庭。")) }
    return try await api.request("/admin/control", auth: auth, device: device)
  }
  func installationPause(device: String, paused: Bool, revision: Int) async throws -> PlaybackState
  {
    if demo, var state = usage?.state {
      state.paused = paused
      state.control_revision = revision + 1
      state.applied_revision = state.control_revision
      state.enforcement_result = paused ? "stopped" : "allowed"
      state.status = paused ? "lock" : "allow"
      return state
    }
    guard let auth else { throw TVError.message(L10n.tr("请先登录家庭。")) }
    if lan.isPaired(with: device) {
      return try await lan.deliver(
        payload: ["kind": "pause", "paused": paused], device: device, revision: revision,
        auth: auth, api: api
      ).state
    }
    return try await api.request(
      "/admin/control", auth: auth, device: device,
      body: ["paused": paused, "request_id": UUID().uuidString])
  }

}
