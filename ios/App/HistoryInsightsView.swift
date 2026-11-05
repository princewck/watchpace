import Charts
import SwiftUI

struct HistoryInsightsSection: View {
  let insights: ViewingInsights
  var body: some View {
    Section {
      VStack(alignment: .leading, spacing: 18) {
        Label(L10n.tr("近 \(insights.count) 天合计"), systemImage: "chart.xyaxis.line")
          .font(.subheadline).foregroundStyle(Color("SupportingText"))
        Text(insights.total.durationText).font(.largeTitle.bold()).contentTransition(.numericText())
        HStack(alignment: .top) {
          metric(L10n.tr("平均每天"), insights.average.durationText)
          Spacer(minLength: 12)
          metric(L10n.tr("有观看记录"), L10n.tr("\(insights.recordedDays) 天"))
        }
        if insights.count <= 30, let change = insights.changePercent {
          Label(
            change == 0
              ? L10n.tr("与上一时段持平")
              : change < 0
                ? L10n.tr("比上一时段减少 \(abs(change))%")
                : L10n.tr("比上一时段增加 \(change)%"),
            systemImage: change == 0
              ? "equal.circle" : change < 0 ? "arrow.down.right" : "arrow.up.right"
          ).font(.subheadline.weight(.medium)).foregroundStyle(Color.accentColor)
        } else {
          Text(L10n.tr("记录会逐日积累，帮助你看清观看习惯的变化。"))
            .font(.subheadline).foregroundStyle(Color("SupportingText"))
        }
      }.padding(.vertical, 8)
    }
  }
  private func metric(_ title: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(title).font(.caption).foregroundStyle(Color("SupportingText"))
      Text(value).font(.headline)
    }
  }
}

struct HistoryAppRow: View {
  let app: String
  let seconds: Int
  let total: Int
  var body: some View {
    VStack(alignment: .leading, spacing: 9) {
      HStack(alignment: .firstTextBaseline) {
        Text(DailyUsage.name(app)).lineLimit(2)
        Spacer(minLength: 12)
        Text(seconds.durationText).monospacedDigit().fixedSize()
      }
      ProgressView(value: Double(seconds), total: Double(max(1, total)))
        .accessibilityLabel(DailyUsage.name(app))
        .accessibilityValue("\(Int(Double(seconds) / Double(max(1, total)) * 100))%")
    }.padding(.vertical, 5)
  }
}

struct HistoryDayView: View {
  @Environment(FamilyStore.self) private var store
  @State private var hourly: [HourlyUsage] = []
  @State private var loading = true
  @State private var failure: String?
  let usage: UsageResponse
  let day: String
  private var apps: [(app: String, seconds: Int)] {
    ViewingInsights(usage: usage, count: 1).apps(on: day)
  }
  var body: some View {
    List {
      Section {
        Label(L10n.tr("当天观看"), systemImage: "play.rectangle")
        Text(apps.reduce(0) { $0 + $1.seconds }.durationText).font(.largeTitle.bold())
      }
      Section(L10n.tr("什么时候看的")) {
        if loading {
          ProgressView()
        } else if let failure {
          Text(failure).font(.subheadline)
          Button(L10n.tr("重试")) { Task { await loadHours() } }
        } else if hourly.isEmpty {
          Text(L10n.tr("这一天还没有时段明细，已有观看总时长仍保留。"))
            .foregroundStyle(Color("SupportingText"))
        } else {
          Chart(hourly) { item in
            BarMark(
              x: .value(L10n.tr("小时"), item.hour),
              y: .value(L10n.tr("分钟"), Double(item.seconds) / 60)
            )
            .foregroundStyle(by: .value(L10n.tr("应用"), DailyUsage.name(item.app_package)))
          }.chartXScale(domain: 0...23).chartXAxis {
            AxisMarks(values: [0, 6, 12, 18, 23]) { value in
              AxisValueLabel {
                if let hour = value.as(Int.self) { Text(String(format: "%02d:00", hour)) }
              }
            }
          }.frame(height: 180).padding(.vertical, 12)
          Text(L10n.tr("时段按北京时间汇总，采样可能有约10秒误差。"))
            .font(.footnote).foregroundStyle(Color("SupportingText"))
        }
      }
      Section(L10n.tr("应用明细")) {
        if apps.isEmpty {
          Text(L10n.tr("当天没有采集到观看记录。")).foregroundStyle(Color("SupportingText"))
        }
        ForEach(apps, id: \.app) { item in
          HistoryAppRow(
            app: item.app, seconds: item.seconds, total: apps.reduce(0) { $0 + $1.seconds })
        }
      }
      Section {
        Text(L10n.tr("这里展示已采集的应用观看时长，不包含视频标题或节目内容。"))
          .font(.footnote).foregroundStyle(Color("SupportingText"))
      }
    }.navigationTitle(day).navigationBarTitleDisplayMode(.inline)
      .task { await loadHours() }
  }
  private func loadHours() async {
    loading = true
    failure = nil
    defer { loading = false }
    if store.demo {
      hourly = apps.enumerated().map { index, item in
        HourlyUsage(hour: 18 + index, app_package: item.app, seconds: item.seconds)
      }
      return
    }
    guard let auth = store.auth, let device = store.selectedID else { return }
    do {
      let response: HistoryDayResponse = try await store.api.request(
        "/admin/history_day", auth: auth, device: device, query: ["day": day])
      hourly = response.hourly
    } catch { failure = L10n.tr("暂时无法读取时段明细，请重试。") }
  }
}
