import XCTest

final class AgePresetFlowTests: XCTestCase {
  @MainActor func testPresetRequiresConfirmationAndPreservesSchedule() {
    let app = XCUIApplication()
    app.launchArguments = ["--demo"]
    app.launchEnvironment["FAMILYTV_UI_LANGUAGE"] = "zh-Hans"
    app.launch()
    app.tabBars.buttons["规则"].tap()
    let choose = app.buttons["chooseAgePreset"]
    for _ in 0..<4 where !choose.isHittable { app.swipeUp() }
    choose.tap()
    app.buttons["agePreset-toddler"].tap()
    XCTAssertTrue(app.alerts["覆盖现有观看设置？"].waitForExistence(timeout: 5))
    app.alerts.buttons["取消"].tap()
    XCTAssertTrue(app.buttons["agePreset-toddler"].exists)
    app.buttons["agePreset-toddler"].tap()
    app.alerts.buttons["确认覆盖"].firstMatch.tap()
    XCTAssertTrue(app.navigationBars["观看规则"].waitForExistence(timeout: 5))
    XCTAssertTrue(
      app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "30 分钟")).firstMatch
        .exists)
    for _ in 0..<3 where !app.staticTexts["每次最多"].exists { app.swipeUp() }
    XCTAssertTrue(
      app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "15 分钟")).firstMatch
        .exists)
    for _ in 0..<3 where !app.staticTexts["睡前休息"].isHittable { app.swipeUp() }
    XCTAssertTrue(app.staticTexts["睡前休息"].exists)
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = "age-preset-applied"
    image.lifetime = .keepAlways
    add(image)
  }
}
