import XCTest

@testable import FamilyTV

final class RestScheduleTests: XCTestCase {
  func testTonightHasNoRemainingWindow() {
    var policy = ViewingPolicy()
    policy.banned_windows = [QuietWindow(start: "20:30", end: "07:00")]
    let now = ISO8601DateFormatter().date(from: "2026-11-07T23:15:00+08:00")!
    let state = PlaybackState(status: "lock", stage: 0, remaining_seconds: 3898)
    XCTAssertEqual(policy.remainingToday(state, at: now), 0)
  }

  func testOverlappingBreaksOnlyRemoveEachMinuteOnceInSavedZone() {
    var policy = ViewingPolicy()
    policy.schedule_time_zone = "Asia/Tokyo"
    policy.banned_windows = [
      QuietWindow(start: "22:30", end: "23:00"),
      QuietWindow(start: "22:45", end: "23:30"),
    ]
    let now = ISO8601DateFormatter().date(from: "2026-11-07T13:00:00Z")!
    var state = PlaybackState(status: "allow", stage: 0, remaining_seconds: 7200)
    XCTAssertEqual(policy.remainingToday(state, at: now), 3600)
    state.remaining_seconds = 900
    XCTAssertEqual(policy.remainingToday(state, at: now), 900)
  }
}
