import Foundation

/// All comparisons use the server's calendar day and include only the selected television.
struct ViewingInsights {
  let usage: UsageResponse
  let count: Int
  var days: [(day: String, seconds: Int)] { usage.days(count) }
  var total: Int { days.reduce(0) { $0 + $1.seconds } }
  var recordedDays: Int { days.filter { $0.seconds > 0 }.count }
  var average: Int { total / max(1, count) }
  var peak: (day: String, seconds: Int)? {
    days.filter { $0.seconds > 0 }.max { $0.seconds < $1.seconds }
  }
  var previousTotal: Int? {
    let all = usage.days(count * 2)
    let previous = Array(all.prefix(count))
    let keys = Set(previous.map(\.day))
    guard usage.daily.contains(where: { keys.contains($0.day) && $0.seconds > 0 }) else {
      return nil
    }
    return previous.reduce(0) { $0 + $1.seconds }
  }
  var changePercent: Int? {
    guard let previousTotal, previousTotal > 0 else { return nil }
    return Int((Double(total - previousTotal) / Double(previousTotal) * 100).rounded())
  }
  func apps(on day: String) -> [(app: String, seconds: Int)] {
    Dictionary(grouping: usage.daily.filter { $0.day == day && $0.seconds > 0 }, by: \.app_package)
      .map { (app: $0.key, seconds: $0.value.reduce(0) { $0 + $1.seconds }) }
      .sorted { $0.seconds == $1.seconds ? $0.app < $1.app : $0.seconds > $1.seconds }
  }
  var apps: [(app: String, seconds: Int)] { usage.appTotals(days: count).filter { $0.seconds > 0 } }
}

struct HourlyUsage: Decodable, Identifiable {
  let hour: Int
  let app_package: String
  let seconds: Int
  var id: String { "\(hour)-\(app_package)" }
}
struct HistoryDayResponse: Decodable {
  let day: String
  let hourly: [HourlyUsage]
}
