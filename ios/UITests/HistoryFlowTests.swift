import XCTest

final class HistoryFlowTests: XCTestCase {
  @MainActor func testHistorySummaryAndDailyBreakdownInChineseAndEnglish() {
    for (language, tab, total, days, dailyTitle) in [
      ("zh-Hans", "记录", "近 7 天合计", "30 天", "应用明细"),
      ("en", "History", "Last 7 days total", "30 days", "App breakdown")
    ] {
      let app = XCUIApplication()
      app.launchArguments = ["--demo"]
      app.launchEnvironment["FAMILYTV_UI_LANGUAGE"] = language
      app.launch()
      app.tabBars.buttons[tab].tap()
      // The summary, chart and per-day navigation are separate discoverable sections.
      XCTAssertTrue(app.staticTexts[total].waitForExistence(timeout: 8))
      capture(app, name: "history-overview-" + language)
      let day = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "historyDay-")).firstMatch
      for _ in 0..<6 where !day.isHittable { app.swipeUp() }
      XCTAssertTrue(day.isHittable)
      day.tap()
      XCTAssertTrue(app.staticTexts[dailyTitle].waitForExistence(timeout: 5))
      capture(app, name: "history-day-" + language)
      app.navigationBars.buttons.element(boundBy: 0).tap()
      for _ in 0..<6 where !app.buttons[days].isHittable { app.swipeDown() }
      app.buttons[days].tap()
      capture(app, name: "history-month-" + language)
      app.terminate()
    }
  }
  @MainActor private func capture(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
