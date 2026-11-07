import Foundation

extension ViewingPolicy {
  static let legacyScheduleZone = "Asia/Shanghai"

  var scheduleZone: TimeZone {
    TimeZone(identifier: schedule_time_zone ?? Self.legacyScheduleZone)
      ?? TimeZone(identifier: Self.legacyScheduleZone)!
  }

  var scheduleZoneLabel: String {
    Self.zoneLabel(scheduleZone)
  }

  static func zoneLabel(_ zone: TimeZone) -> String {
    let formatter = DateFormatter()
    formatter.locale = L10n.locale
    formatter.timeZone = zone
    formatter.dateFormat = "VVVV"
    let place = formatter.string(from: .now)
    formatter.dateFormat = "ZZZZZ"
    let offset = formatter.string(from: .now)
    return "\(place) · UTC\(offset == "Z" ? "+00:00" : offset)"
  }

  func remainingToday(_ state: PlaybackState, at now: Date = .now) -> Int {
    let allowance = max(0, state.remaining_seconds)
    guard allowance > 0 else { return 0 }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = scheduleZone
    guard let endOfDay = calendar.dateInterval(of: .day, for: now)?.end else { return 0 }
    if (state.override_seconds ?? 0) > 0 {
      let expires =
        state.bonus_expires_ms.map { Date(timeIntervalSince1970: $0 / 1000) }
        ?? endOfDay
      return min(allowance, max(0, Int(min(endOfDay, expires).timeIntervalSince(now))))
    }
    let windows = banned_windows.filter(\.enabled).map(RestWindow.init)
    if windows.isEmpty {
      return min(allowance, max(0, Int(endOfDay.timeIntervalSince(now))))
    }

    // Walk real minutes, so a repeated or skipped DST hour has its actual duration.
    var cursor = now
    var available: TimeInterval = 0
    while cursor < endOfDay {
      let parts = calendar.dateComponents([.weekday, .hour, .minute], from: cursor)
      guard let weekday = parts.weekday, let hour = parts.hour, let minute = parts.minute
      else { break }
      let boundary = Date(
        timeIntervalSince1970: (floor(cursor.timeIntervalSince1970 / 60) + 1) * 60)
      let next = min(boundary, endOfDay)
      if !windows.contains(where: { $0.contains(day: weekday - 1, minute: hour * 60 + minute) }) {
        available += next.timeIntervalSince(cursor)
        if available >= Double(allowance) { return allowance }
      }
      cursor = next
    }
    return Int(available)
  }
}

private struct RestWindow {
  let days: Set<Int>
  let start: Int
  let end: Int

  init(_ window: QuietWindow) {
    days = Set(window.days)
    start = Self.minutes(window.start)
    end = Self.minutes(window.end)
  }

  func contains(day: Int, minute: Int) -> Bool {
    if start == end { return days.contains(day) }
    if start < end { return days.contains(day) && minute >= start && minute < end }
    return (days.contains(day) && minute >= start) || (days.contains((day + 6) % 7) && minute < end)
  }

  private static func minutes(_ time: String) -> Int {
    let parts = time.split(separator: ":")
    guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else { return 0 }
    return hour * 60 + minute
  }
}
