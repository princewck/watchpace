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
  static func download(
    release: TVRelease, progress: @MainActor (Int, Double) -> Void
  ) async throws -> Data {
    try release.validate()
    let url = URL(string: release.url)!
    for attempt in 1...2 {
      await progress(attempt, 0)
      do {
        return try await downloadOnce(
          url: url, release: release, attempt: attempt, progress: progress)
      } catch let error as URLError where isTemporary(error) {
        try Task.checkCancellation()
        if attempt == 1 {
          try await Task.sleep(for: .seconds(1))
        } else if error.code == .timedOut {
          throw TVError.message(L10n.tr("下载安装包超时，已重试一次。请检查手机网络后再试。"))
        } else {
          throw TVError.message(L10n.tr("手机未能连接安装包下载站，已重试一次。请检查网络后再试。"))
        }
      }
    }
    throw TVError.message(L10n.tr("暂时无法下载电视更新，请稍后重试。"))
  }

  private static func isTemporary(_ error: URLError) -> Bool {
    [
      .timedOut, .cannotFindHost, .dnsLookupFailed, .cannotConnectToHost,
      .networkConnectionLost, .notConnectedToInternet, .resourceUnavailable,
    ].contains(error.code)
  }

  private static func downloadOnce(
    url: URL, release: TVRelease, attempt: Int, progress: @MainActor (Int, Double) -> Void
  ) async throws -> Data {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForResource = attempt == 1 ? 30 : 60
    let session = URLSession(configuration: configuration)
    defer { session.invalidateAndCancel() }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
    request.timeoutInterval = attempt == 1 ? 20 : 45
    let (stream, response) = try await session.bytes(for: request)
    guard let http = response as? HTTPURLResponse, response.url == url else {
      throw TVError.message(L10n.tr("暂时无法下载电视更新，请稍后重试。"))
    }
    if [408, 429, 500, 502, 503, 504].contains(http.statusCode) {
      throw URLError(.resourceUnavailable)
    }
    guard http.statusCode == 200 else {
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
      if data.count.isMultiple(of: 8192) {
        await progress(attempt, Double(data.count) / Double(release.size))
      }
    }
    try verify(data, release: release)
    await progress(attempt, 1)
    return data
  }
}
