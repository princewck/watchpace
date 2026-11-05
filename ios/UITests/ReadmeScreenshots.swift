import XCTest

/// Public product screenshots: synthetic data, no account or device credentials.
final class ReadmeScreenshots: XCTestCase {
  @MainActor func testCaptureFourLanguages() {
    for (language, today, rules, history) in [
      ("en", "Today", "Rules", "History"),
      ("zh-Hans", "今天", "规则", "记录"),
      ("ja", "今日", "ルール", "記録"),
      ("ko", "오늘", "규칙", "기록")
    ] {
      let app = XCUIApplication()
      app.launchArguments = ["--demo"]
      app.launchEnvironment["FAMILYTV_UI_LANGUAGE"] = language
      app.launch()
      XCTAssertTrue(app.tabBars.buttons[today].waitForExistence(timeout: 10))
      app.swipeUp()
      let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
      let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.52))
      from.press(forDuration: 0.2, thenDragTo: to)
      capture(app, "\(language)-phone-today")
      app.tabBars.buttons[rules].tap()
      capture(app, "\(language)-phone-rules")
      app.tabBars.buttons[history].tap()
      app.swipeUp()
      let chartFrom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
      let chartTo = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.52))
      chartFrom.press(forDuration: 0.2, thenDragTo: chartTo)
      capture(app, "\(language)-phone-history")
      let day = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "historyDay-")).firstMatch
      for _ in 0..<6 where !day.isHittable { app.swipeUp() }
      XCTAssertTrue(day.isHittable)
      day.tap()
      capture(app, "\(language)-phone-day")
      app.terminate()
    }
  }
  @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
