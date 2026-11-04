import XCTest

@testable import FamilyTV

final class InstallationProgressTests: XCTestCase {
  func testCurrentTaskAdvancesOnlyOnDeviceProof() {
    var checks = InstallationChecks(
      connected: false, playback_test: false, adb_closed: false, rebooted: false, permissions: false
    )
    XCTAssertEqual(InstallationProgress.next(checks), .connection)
    checks.connected = true
    XCTAssertEqual(InstallationProgress.next(checks), .permissions)
    checks.permissions = true
    XCTAssertEqual(InstallationProgress.next(checks), .playback)
    checks.playback_test = true
    XCTAssertEqual(InstallationProgress.next(checks), .debugging)
    checks.adb_closed = true
    XCTAssertEqual(InstallationProgress.next(checks), .reboot)
    checks.rebooted = true
    XCTAssertEqual(InstallationProgress.next(checks), .complete)
  }
  func testSentPauseCannotBeConfusedWithExecutedPause() {
    var state = DemoData.usage().state
    state.paused = true
    state.control_revision = 8
    state.applied_revision = 7
    state.enforcement_result = "stopped"
    XCTAssertFalse(InstallationProgress.pauseConfirmed(state))
    state.applied_revision = 8
    XCTAssertTrue(InstallationProgress.pauseConfirmed(state))
    state.enforcement_result = "failed"
    XCTAssertFalse(InstallationProgress.pauseConfirmed(state))
  }
}
