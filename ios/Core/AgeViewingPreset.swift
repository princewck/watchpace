import Foundation

/// Age bands select settings; no birthday or child profile is collected or stored.
enum AgeViewingPreset: String, CaseIterable, Identifiable {
  case infant, toddler, preschool, schoolAge
  var id: String { rawValue }
  var title: String {
    switch self {
    case .infant: L10n.tr("18个月以下")
    case .toddler: L10n.tr("18至不足24个月")
    case .preschool: L10n.tr("24至不足72个月")
    case .schoolAge: L10n.tr("72个月及以上")
    }
  }
  var dailySeconds: Int {
    switch self {
    case .infant: 0
    case .toddler: 1800
    case .preschool: 3600
    case .schoolAge: 7200
    }
  }
  var sessionSeconds: Int? {
    switch self {
    case .toddler, .preschool: 900
    default: nil
    }
  }
  var detail: String {
    switch self {
    case .infant: L10n.tr("不推荐观看，预设每日额度为0。")
    case .toddler: L10n.tr("每天最多30分钟，每次最多15分钟；每次休息至少5分钟。")
    case .preschool: L10n.tr("每天最多1小时，每次最多15分钟；每次休息至少5分钟。")
    case .schoolAge: L10n.tr("每天最多2小时，不设置单次观看上限。")
    }
  }
  func applying(to original: ViewingPolicy) -> ViewingPolicy {
    var policy = original
    policy.daily_limit_seconds = dailySeconds
    policy.session_limit_seconds = sessionSeconds
    policy.session_break_seconds = 300
    return policy
  }
}
