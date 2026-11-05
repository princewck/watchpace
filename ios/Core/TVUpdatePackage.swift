import CryptoKit
import Foundation

struct TVUpdateReceipt: Decodable {
  let status: String
  let received: Int
  let size: Int
  let version_code: Int
}
struct TVRelease: Decodable {
  let version: String
  let version_code: Int
  let package: String
  let url: String
  let sha256: String
  let size: Int
  static let bundled = TVRelease(
    version: ReleaseDownloads.apkVersion, version_code: ReleaseDownloads.apkVersionCode,
    package: "org.example.tvchallenge", url: ReleaseDownloads.apkURL,
    sha256: ReleaseDownloads.apkSHA256, size: ReleaseDownloads.apkSize)
  func validate() throws {
    guard let link = URL(string: url), link.scheme == "https",
      link.host == URL(string: ReleaseDownloads.apkURL)?.host,
      link.user == nil, link.password == nil, link.query == nil, link.fragment == nil,
      link.path == "/downloads/tv/\(version)/family-tv.apk",
      version.range(of: "^[0-9]+\\.[0-9]+\\.[0-9]+$", options: .regularExpression) != nil,
      package == "org.example.tvchallenge", version_code >= ReleaseDownloads.apkVersionCode,
      (1...8_388_608).contains(size),
      sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
    else { throw TVError.message(L10n.tr("更新信息无效，请联系支持。")) }
  }
}
/// HTTPS release feed discovers later TV versions without rebuilding the phone app.
enum TVUpdatePackage {
  static func latest() async throws -> TVRelease {
    let url = URL(string: ReleaseDownloads.manifestURL)!
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
    request.timeoutInterval = 10
    let (bytes, response) = try await URLSession.shared.bytes(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200, response.url == url else {
      throw TVError.message(L10n.tr("更新信息无效，请联系支持。"))
    }
    var data = Data()
    for try await byte in bytes {
      try Task.checkCancellation()
      guard data.count < 65536 else { throw TVError.message(L10n.tr("更新信息无效，请联系支持。")) }
      data.append(byte)
    }
    struct Feed: Decodable { let apk: TVRelease }
    let release = try JSONDecoder().decode(Feed.self, from: data).apk
    try release.validate()
    return release
  }
  static func verify(_ data: Data, release: TVRelease = .bundled) throws {
    try release.validate()
    let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    guard data.count == release.size, hash == release.sha256 else {
      throw TVError.message(L10n.tr("安装包校验未通过，未发送到电视。请稍后重试。"))
    }
  }
  static func download(release: TVRelease) async throws -> Data {
    try release.validate()
    let url = URL(string: release.url)!
    var request = URLRequest(url: url)
    request.timeoutInterval = 30
    let (stream, response) = try await URLSession.shared.bytes(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200, response.url == url else {
      throw TVError.message(L10n.tr("暂时无法下载电视更新，请稍后重试。"))
    }
    var data = Data()
    data.reserveCapacity(release.size)
    for try await byte in stream {
      try Task.checkCancellation()
      data.append(byte)
      guard data.count <= release.size else {
        throw TVError.message(L10n.tr("安装包大小异常，已停止下载。"))
      }
    }
    try verify(data, release: release)
    return data
  }
}
