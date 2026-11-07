import CryptoKit
import DeviceCheck
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
  func validate(origin: URL? = nil) throws {
    guard let link = URL(string: url) else {
      throw TVError.message(L10n.tr("更新信息无效，请联系支持。"))
    }
    let trusted: Bool
    if let origin {
      trusted = link == origin.appendingPathComponent("admin/tv-update/download")
    } else {
      trusted =
        link.host == URL(string: ReleaseDownloads.apkURL)?.host
        && link.path == "/downloads/tv/\(version)/family-tv.apk"
    }
    guard trusted, link.scheme == "https",
      link.user == nil, link.password == nil, link.query == nil, link.fragment == nil,
      version.range(of: "^[0-9]+\\.[0-9]+\\.[0-9]+$", options: .regularExpression) != nil,
      package == "org.example.tvchallenge", version_code >= ReleaseDownloads.apkVersionCode,
      (1...8_388_608).contains(size),
      sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
    else { throw TVError.message(L10n.tr("更新信息无效，请联系支持。")) }
  }
}
/// HTTPS release feed discovers later TV versions without rebuilding the phone app.
enum TVUpdatePackage {
  static func latest(api: TVAPI, auth: SavedSession, device: String) async throws -> TVRelease {
    let release: TVRelease = try await api.request(
      "/admin/tv-update/latest", auth: auth, device: device, timeout: 10)
    try release.validate(origin: auth.origin)
    return release
  }

  static func verify(_ data: Data, release: TVRelease = .bundled, origin: URL? = nil) throws {
    try release.validate(origin: origin)
    let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    guard data.count == release.size, hash == release.sha256 else {
      throw TVError.message(L10n.tr("安装包校验未通过，未发送到电视。请稍后重试。"))
    }
  }
  private struct Challenge: Decodable {
    let challenge: String
    let version_code: Int
  }

  @MainActor static func download(
    release: TVRelease, api: TVAPI, auth: SavedSession, device: String
  ) async throws -> Data {
    try release.validate(origin: auth.origin)
    let service = DCAppAttestService.shared
    guard service.isSupported else {
      throw TVError.message(L10n.tr("这台手机暂不支持 App 验证，无法下载电视更新。"))
    }
    let keyScope = Data((auth.origin.absoluteString + "|" + auth.identity.tenant_id).utf8)
    let preference = "tv-update-attest." + SHA256.hash(data: keyScope).description
    let challenge: Challenge = try await api.request(
      "/admin/tv-update/challenge", auth: auth, device: device, body: [:], timeout: 15)
    guard challenge.version_code == release.version_code else {
      throw TVError.message(L10n.tr("电视更新版本已变化，请刷新后重试。"))
    }
    let challengeHash = Data(SHA256.hash(data: Data(challenge.challenge.utf8)))
    let key: String
    let proof: Data
    let kind: String
    let existing = UserDefaults.standard.string(forKey: preference)
    do {
      if let existing {
        key = existing
        proof = try await service.generateAssertion(key, clientDataHash: challengeHash)
        kind = "assertion"
      } else {
        key = try await service.generateKey()
        proof = try await service.attestKey(key, clientDataHash: challengeHash)
        kind = "attestation"
      }
    } catch {
      if (error as? DCError)?.code == .invalidKey {
        UserDefaults.standard.removeObject(forKey: preference)
      }
      throw TVError.message(L10n.tr("手机 App 验证未通过，暂时无法下载安装包。"))
    }
    let data = try await api.downloadTVUpdate(
      auth: auth, device: device,
      proof: [
        "challenge": challenge.challenge, "key_id": key,
        "kind": kind, "proof": proof.base64EncodedString(),
      ])
    if existing == nil { UserDefaults.standard.set(key, forKey: preference) }
    try verify(data, release: release, origin: auth.origin)
    return data
  }
}
