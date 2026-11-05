import Charts
import SwiftUI

struct HistoryView: View {
  @Environment(FamilyStore.self) private var store
  @Environment(SubscriptionStore.self) private var subscription
  @State private var syncing = false
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @ScaledMetric(relativeTo: .body) private var chartHeight: CGFloat = 190
  @State private var range = 7
  var body: some View {
    List {
      TVSelectionSection()
      if store.demo { Section { DemoBanner() } }
      if let failure = store.loadState.failure {
        Section {
          Label(failure, systemImage: "wifi.exclamationmark").font(.subheadline)
          Text(L10n.tr("以下记录可能尚未更新。")).font(.footnote).foregroundStyle(Color("SupportingText"))
        }
      }
      if !store.historyAccess && !store.demo
        && subscription.hasAccess(for: store.billingHouseholdID)
      {
        Section {
          Label(L10n.tr("购买已完成，观看记录尚未解锁"), systemImage: "arrow.triangle.2.circlepath")
          Text(L10n.tr("请同步购买状态，无需再次付费。")).font(.subheadline)
          Button(L10n.tr("同步购买并查看记录")) { Task { await syncPurchase() } }
            .disabled(syncing)
          if syncing { ProgressView() }
          if let error = store.subscriptionSyncError { Text(error).font(.footnote) }
        }
      }
      if !store.historyAccess && !store.demo {
        Section {
          ContentUnavailableView(
            L10n.tr("看见更长远的变化"), systemImage: "chart.bar.xaxis",
            description: Text(L10n.tr("订阅家庭云 Plus，保存云端观看历史并查看趋势分析。")))
          NavigationLink(L10n.tr("了解家庭云 Plus")) { SubscriptionView() }
        }
      } else if let usage = store.usage {
        HistoryInsightsSection(insights: ViewingInsights(usage: usage, count: range))
        Section {
          Picker(L10n.tr("记录范围"), selection: $range) {
            Text(L10n.tr("7 天")).tag(7)
            Text(L10n.tr("30 天")).tag(30)
            Text(L10n.tr("180 天")).tag(180)
          }.pickerStyle(.segmented)
        }
        Section(L10n.tr("最近 \(range) 天")) {
          Chart(usage.days(range), id: \.day) { item in
            BarMark(
              x: .value(
                L10n.tr("日期"), Self.dayFormatter.date(from: item.day) ?? .distantPast, unit: .day),
              y: .value(L10n.tr("分钟"), Double(item.seconds) / 60)
            )
            .foregroundStyle(Color.accentColor)
            .accessibilityLabel(item.day).accessibilityValue(item.seconds.durationText)
          }
          .chartXAxis {
            AxisMarks(values: dateLabels(usage)) { value in
              AxisGridLine()
              AxisTick()
              AxisValueLabel {
                if let date = value.as(Date.self) {
                  Text(Self.axisFormatter.string(from: date)).foregroundStyle(Color.primary)
                }
              }
            }
          }
          .chartYAxis {
            AxisMarks(values: .automatic(desiredCount: dynamicTypeSize.isAccessibilitySize ? 3 : 4))
            { _ in
              AxisGridLine()
              AxisTick()
              AxisValueLabel().foregroundStyle(Color.primary)
            }
          }
          .chartYAxisLabel { Text(L10n.tr("分钟")).foregroundStyle(Color.primary) }
          .environment(\.calendar, Self.chartCalendar)
          .frame(height: chartHeight).padding(.vertical, 12)
        }
        Section(L10n.tr("应用分析")) {
          ForEach(usage.appTotals(days: range), id: \.app) { item in
            HistoryAppRow(
              app: item.app, seconds: item.seconds,
              total: usage.days(range).reduce(0) { $0 + $1.seconds })
          }
          if usage.appTotals(days: range).isEmpty {
            Text(L10n.tr("这段时间尚无采集记录。")).foregroundStyle(Color("SupportingText"))
          }
        }
        Section(L10n.tr("每日观看")) {
          ForEach(usage.days(range).reversed(), id: \.day) { item in
            NavigationLink {
              HistoryDayView(usage: usage, day: item.day)
            } label: {
              HStack {
                Text(item.day)
                Spacer()
                Text(item.seconds.durationText).foregroundStyle(Color("SupportingText"))
              }
            }.accessibilityIdentifier("historyDay-" + item.day)
          }
        }
        Section {
          Text(L10n.tr("仅统计所选电视的受管应用播放采样，存在采样误差；日期按北京时间。未采集到记录不等于没有观看。"))
            .font(.footnote).foregroundStyle(Color.primary)
        }
      } else {
        ContentUnavailableView(
          L10n.tr("还没有观看记录"), systemImage: "chart.bar",
          description: Text(L10n.tr("连接电视后，受管应用的观看记录会显示在这里。")))
      }
      if store.capabilities?.paid_history == true { SubscriptionAccessSection() }
    }.navigationTitle(L10n.tr("观看记录"))
      .refreshable {
        await syncPurchase()
        await store.refresh()
      }
      .task(id: store.selectedID) {
        if !store.demo {
          await subscription.refreshEntitlements()
          await syncPurchase()
        }
      }
  }
  private func syncPurchase() async {
    guard !syncing, !store.demo, let id = store.billingHouseholdID,
      let token = UUID(uuidString: id), subscription.hasAccess(for: id)
    else { return }
    syncing = true
    defer { syncing = false }
    let accepted = await store.syncSubscriptions(
      subscription.receipts(
        for: token, ownedOriginalIDs: Set(store.premium.original_ids ?? [])))
    await subscription.finishSyncedTransactions(transactionIDs: accepted)
  }
  private func durationRow(_ title: String, seconds: Int) -> some View {
    LabeledContent(title) { Text(seconds.durationText).foregroundStyle(Color.primary) }
  }
  private static let chartCalendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    return calendar
  }()
  private static let dayFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
  }()
  private static let axisFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "MM-dd"
    return formatter
  }()
  private func dateLabels(_ usage: UsageResponse) -> [Date] {
    let days = usage.days(range)
    let step =
      range == 180
      ? 30 : dynamicTypeSize.isAccessibilitySize ? (range == 7 ? 3 : 14) : (range == 7 ? 1 : 7)
    return days.enumerated().filter { $0.offset % step == 0 }.compactMap {
      Self.dayFormatter.date(from: $0.element.day)
    }
  }
}
