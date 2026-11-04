import Foundation

/// Labels are presentation only; authentication remains bound to the exact HTTPS origin.
enum ServiceEndpoint {
  static let officialOrigin = "https://tv.chengkai.wang"
  // Only the former official origin migrates; custom deployments stay unchanged.
  static func migratedOfficialOrigin(_ url: URL) -> URL {
    url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      == "https://familytv-api.princewck.workers.dev"
      ? URL(string: officialOrigin)! : url
  }
  static func isOfficial(_ origin: String) -> Bool {
    guard let url = try? TVAPI.validateOrigin(origin) else { return false }
    return url.absoluteString == officialOrigin
  }
  static func label(for origin: String) -> String {
    isOfficial(origin) ? L10n.tr("官方服务") : L10n.tr("自定义部署")
  }
}
enum ServiceSelection: String, CaseIterable, Identifiable {
  case official, custom
  var id: String { rawValue }
  var title: String { self == .official ? L10n.tr("官方服务") : L10n.tr("自定义部署") }
  func origin(custom: String) -> String {
    self == .official
      ? ServiceEndpoint.officialOrigin : custom.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}
