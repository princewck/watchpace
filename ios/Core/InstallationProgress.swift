import Foundation

enum InstallationProgress: Int, CaseIterable {
  case connection, permissions, playback, debugging, reboot, complete

  static func next(_ checks: InstallationChecks?) -> Self {
    guard let checks, checks.connected else { return .connection }
    guard checks.permissions else { return .permissions }
    guard checks.playback_test else { return .playback }
    guard checks.adb_closed else { return .debugging }
    guard checks.rebooted else { return .reboot }
    return .complete
  }

  static func pauseConfirmed(_ state: PlaybackState?) -> Bool {
    guard let state, state.paused == true,
      let revision = state.control_revision, let applied = state.applied_revision
    else { return false }
    return revision == applied && state.enforcement_result == "stopped"
  }
}
