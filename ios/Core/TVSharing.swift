import Foundation

struct TVShareCode: Codable {
  var code: String
  var request_id: String
  var expires_ms: Double
  var endpoint: String
  var device: String
  var label: String
  var link: String {
    var parts = URLComponents()
    parts.scheme = "watchpace"
    parts.host = "tv-share"
    parts.queryItems = [
      URLQueryItem(name: "endpoint", value: endpoint), URLQueryItem(name: "code", value: code),
    ]
    return parts.url?.absoluteString ?? ""
  }
}
struct TVShareRequest: Codable {
  var request_id: String
  var status: String
  var device: String
  var label: String
}
struct TVSharePeople: Codable {
  struct Request: Codable, Identifiable {
    var request_id: String
    var username: String
    var id: String { request_id }
  }
  struct Member: Codable, Identifiable {
    var household_id: String
    var username: String
    var id: String { household_id }
  }
  var requests: [Request]
  var members: [Member]
}
struct TVShareLink {
  let origin: URL
  let code: String
  init(_ value: String) throws {
    guard value.count < 2048, let parts = URLComponents(string: value),
      parts.scheme == "watchpace", parts.host == "tv-share", parts.user == nil,
      parts.password == nil, parts.port == nil, parts.path.isEmpty, parts.fragment == nil,
      let parameters = parts.queryItems, parameters.count == 2,
      parameters.filter({ $0.name == "endpoint" }).count == 1,
      parameters.filter({ $0.name == "code" }).count == 1,
      let endpoint = parameters.first(where: { $0.name == "endpoint" })?.value,
      let code = parameters.first(where: { $0.name == "code" })?.value,
      code.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil
    else { throw TVError.message(L10n.tr("这不是观有度的电视分享码，请让另一位家长重新分享。")) }
    self.origin = try TVAPI.validateOrigin(endpoint)
    self.code = code
  }
}
