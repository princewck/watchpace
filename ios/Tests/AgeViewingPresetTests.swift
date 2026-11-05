import XCTest

@testable import FamilyTV

final class AgeViewingPresetTests: XCTestCase {
  func testPresetsOnlyReplaceTheThreeSpecifiedFields() {
    var original = ViewingPolicy()
    original.banned_windows = [QuietWindow(id: "bedtime")]
    original.default_grant_seconds = 600
    for (preset, daily, session) in [
      (AgeViewingPreset.infant, 0, nil), (.toddler, 1800, 900), (.preschool, 3600, 900),
      (.schoolAge, 7200, nil),
    ] {
      let result = preset.applying(to: original)
      XCTAssertEqual(result.daily_limit_seconds, daily)
      XCTAssertEqual(result.session_limit_seconds, session)
      XCTAssertEqual(result.session_break_seconds, 300)
      XCTAssertEqual(result.banned_windows, original.banned_windows)
      XCTAssertEqual(result.default_grant_seconds, 600)
      XCTAssertTrue(result.isValid)
    }
  }
  func testOldPoliciesDecodeAndInvalidBreakIsRejected() throws {
    let data = Data(
      #"{"initial_seconds":1800,"first_reward_seconds":1200,"second_reward_seconds":300,"repeat_seconds":120,"rest_reset_seconds":18000,"default_grant_seconds":900,"banned_windows":[]}"#
        .utf8)
    var policy = try JSONDecoder().decode(ViewingPolicy.self, from: data)
    XCTAssertNil(policy.session_limit_seconds)
    XCTAssertTrue(policy.isValid)
    policy.session_break_seconds = 299
    XCTAssertFalse(policy.isValid)
  }
  func testTVReleaseRejectsRedirectHostsAndDowngrades() throws {
    try TVRelease.bundled.validate()
    let base = TVRelease.bundled
    for (url, version) in [
      ("https://untrusted.invalid/downloads/tv/5.0.7/family-tv.apk", base.version_code),
      (base.url, base.version_code - 1),
      (base.url + "?token=unexpected", base.version_code),
    ] {
      let candidate = TVRelease(
        version: base.version, version_code: version, package: base.package,
        url: url, sha256: base.sha256, size: base.size)
      XCTAssertThrowsError(try candidate.validate())
    }
  }
  func testUpdateManifestRejectsCorruptDataBeforeLANTransfer() {
    XCTAssertThrowsError(try TVUpdatePackage.verify(Data("not-an-apk".utf8)))
  }
}
