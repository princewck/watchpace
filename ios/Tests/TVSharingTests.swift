import XCTest

@testable import FamilyTV

final class TVSharingTests: XCTestCase {
  func testInvitationRoundTripPreservesCustomServer() throws {
    let value = TVShareCode(
      code: String(repeating: "a", count: 43), request_id: UUID().uuidString,
      expires_ms: 1, endpoint: "https://family.example:8443", device: "television",
      label: "Living room")
    let parsed = try TVShareLink(value.link)
    XCTAssertEqual(parsed.origin.absoluteString, value.endpoint)
    XCTAssertEqual(parsed.code, value.code)
  }
  func testUntrustedLinksCannotSelectAnInsecureServerOrDuplicateCode() {
    let code = String(repeating: "a", count: 43)
    for link in [
      "https://example.com/?endpoint=https://family.example&code=\(code)",
      "watchpace://tv-share?endpoint=http://family.example&code=\(code)",
      "watchpace://tv-share?endpoint=https://family.example&code=\(code)&code=\(code)",
      "watchpace://tv-share?endpoint=https://user:password@family.example&code=\(code)",
      "watchpace://tv-share?endpoint=https://family.example/admin&code=\(code)",
      "watchpace://tv-share?endpoint=https://family.example&code=short",
    ] { XCTAssertThrowsError(try TVShareLink(link), link) }
  }
}
