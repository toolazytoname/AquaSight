import XCTest

final class AquaSightUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    private func launch(extra: [String] = [], reset: Bool = true, chooseSources: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestFixtures", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"] + (reset ? ["-uiTestResetStore"] : []) + extra
        app.launch()
        if reset && chooseSources {
            XCTAssertTrue(app.buttons["选择信息源"].waitForExistence(timeout: 10))
            app.buttons["选择信息源"].tap()
            XCTAssertTrue(app.buttons["reader-starter"].waitForExistence(timeout: 5))
            app.buttons["reader-starter"].tap()
            app.buttons["save-subscriptions"].tap()
        }
        return app
    }
    private func row(_ app: XCUIApplication, _ id: String = "evt-gamma") -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "event-" + id).firstMatch
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func revealSource(_ app: XCUIApplication, _ id: String) {
        let button = app.buttons[id]
        for _ in 0..<6 {
            if button.exists && button.isHittable && button.frame.maxY < app.buttons["save-subscriptions"].frame.minY { return }
            app.swipeUp()
        }
    }
    func testFirstRunSelectionAndUnsubscribeKeepsFavorites() {
        let app = launch(chooseSources: false)
        XCTAssertTrue(app.buttons["选择信息源"].waitForExistence(timeout: 10))
        XCTAssertFalse(row(app).exists)
        capture(app, "reader-welcome")
        app.buttons["选择信息源"].tap()
        revealSource(app, "source-openai")
        app.buttons["source-openai"].tap()
        XCTAssertEqual(app.buttons["source-openai"].value as? String, "已选择")
        XCTAssertTrue(app.buttons["save-subscriptions"].isEnabled)
        capture(app, "reader-subscriptions")
        app.buttons["save-subscriptions"].tap()
        XCTAssertTrue(row(app).waitForExistence(timeout: 10))
        app.buttons["收藏 视觉模型更新"].tap()
        capture(app, "reader-feed")
        app.tabBars.buttons["订阅"].tap()
        revealSource(app, "source-openai")
        app.buttons["source-openai"].tap()
        app.buttons["save-subscriptions"].tap()
        XCTAssertTrue(app.buttons["选择信息源"].waitForExistence(timeout: 5))
        app.tabBars.buttons["收藏"].tap()
        XCTAssertTrue(row(app).waitForExistence(timeout: 5))
        row(app).tap()
        XCTAssertTrue(app.staticTexts["detail-title"].waitForExistence(timeout: 5))
    }

    func testAboutAndPrivacyAreAvailableWithoutLogin() {
        let app = launch()
        app.buttons["关于与帮助"].tap()
        XCTAssertTrue(app.buttons["隐私政策"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["帮助与支持"].exists)
        XCTAssertTrue(app.buttons["联系支持：lazywc@gmail.com"].exists)
        capture(app, "11-about-privacy")
        app.buttons["完成"].tap()
        app.tabBars.buttons["收藏"].tap()
        app.buttons["关于与帮助"].tap()
        XCTAssertTrue(app.buttons["隐私政策"].waitForExistence(timeout: 5))
    }

    func testThreeTabsNavigate() {
        let app = launch(); XCTAssertTrue(row(app).waitForExistence(timeout: 10)); capture(app, "01-featured")
        for tab in ["订阅", "收藏", "阅读"] { app.tabBars.buttons[tab].tap(); XCTAssertTrue(app.navigationBars[tab].waitForExistence(timeout: 5)) }
        XCTAssertTrue(row(app).exists)
    }
    func testProjectDetailAndSourceLink() {
        let app = launch()
        XCTAssertTrue(row(app, "repo-one").waitForExistence(timeout: 10)); capture(app, "02-opensource")
        row(app, "repo-one").tap()
        XCTAssertTrue(app.staticTexts["detail-title"].waitForExistence(timeout: 5))
        app.swipeUp()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "次星标")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["TypeScript"].exists || app.staticTexts["· TypeScript"].exists)
        capture(app, "03-project-detail")
    }
    func testSearchFiltersAndClears() {
        let app = launch(); XCTAssertTrue(row(app).waitForExistence(timeout: 10))
        let field = app.textFields["搜索阅读"]; field.tap(); field.typeText("no-match-xyz")
        XCTAssertTrue(app.staticTexts["没有符合条件的内容"].waitForExistence(timeout: 8))
        app.buttons["清除搜索"].tap(); XCTAssertTrue(row(app).waitForExistence(timeout: 8))
    }
    func testDetailSaveRelaunchAndUnsave() {
        let app = launch(); XCTAssertTrue(row(app).waitForExistence(timeout: 10)); row(app).tap()
        XCTAssertTrue(app.staticTexts["AI 中文概述"].waitForExistence(timeout: 10)); capture(app, "04-reading")
        app.buttons["detail-save"].tap()
        XCTAssertEqual(app.buttons["detail-save"].label, "取消收藏")
        app.tabBars.buttons["收藏"].tap(); XCTAssertTrue(row(app).waitForExistence(timeout: 5))
        app.terminate(); let reopened = launch(reset: false); reopened.tabBars.buttons["收藏"].tap()
        XCTAssertTrue(row(reopened).waitForExistence(timeout: 10)); capture(reopened, "05-saved")
        reopened.buttons["取消收藏 视觉模型更新"].tap()
        XCTAssertTrue(reopened.staticTexts["还没有收藏"].waitForExistence(timeout: 5))
        XCTAssertFalse(reopened.staticTexts["detail-title"].exists, "bookmark tap must not open detail")
    }
    func testErrorRetryRecovers() {
        let app = launch(extra: ["-uiTestError"])
        XCTAssertTrue(app.buttons["重试加载"].waitForExistence(timeout: 10)); capture(app, "06-retry")
        app.buttons["重试加载"].tap(); XCTAssertTrue(row(app).waitForExistence(timeout: 10))
    }
    func testLoginValidation() {
        let app = launch(); app.buttons["登录"].firstMatch.tap()
        let email = app.textFields["login-email"], submit = app.buttons["login-submit"]
        XCTAssertTrue(email.waitForExistence(timeout: 5)); XCTAssertFalse(submit.isEnabled)
        XCTAssertFalse(app.textFields["login-code"].exists)
        capture(app, "login-password-polished")
        email.tap(); email.typeText("reader@example.com")
        let password = app.secureTextFields["login-password"]
        password.tap(); password.typeText("Reader-test-2026!")
        XCTAssertTrue(submit.isEnabled)
        app.buttons["显示密码"].tap(); XCTAssertTrue(app.textFields["login-password"].exists)
        app.buttons["隐藏密码"].tap(); XCTAssertTrue(password.exists)
        app.buttons["取消"].tap()
    }
    func testRegistrationCodeAndPasswordConfirmation() {
        let app = launch(); app.buttons["登录"].firstMatch.tap()
        app.buttons["login-mode"].tap()
        let email = app.textFields["login-email"]
        email.tap(); email.typeText("reader@example.com")
        app.buttons["login-send"].tap()
        let code = app.textFields["login-code"]
        XCTAssertTrue(code.waitForExistence(timeout: 5)); code.tap(); code.typeText("000000")
        app.secureTextFields["login-password"].tap(); app.secureTextFields["login-password"].typeText("Reader-test-2026!")
        let confirmation = app.secureTextFields["login-confirm-password"]
        app.swipeUp(); confirmation.tap(); confirmation.typeText("Reader-test-2026!")
        app.swipeUp()
        XCTAssertTrue(app.buttons["login-submit"].isEnabled)
        capture(app, "register-password-polished")
        app.buttons["login-submit"].tap()
        XCTAssertTrue(app.buttons["账户"].waitForExistence(timeout: 10))
    }
    func testFixtureLoginTransfersGuestFavoritesAndLogoutIsolatesThem() {
        let app = launch(); XCTAssertTrue(row(app).waitForExistence(timeout: 10))
        app.buttons["收藏 视觉模型更新"].tap()
        app.buttons["登录"].firstMatch.tap()
        let email = app.textFields["login-email"], password = app.secureTextFields["login-password"]
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        email.tap(); email.typeText("reader@example.com")
        password.tap(); password.typeText("Reader-test-2026!")
        app.buttons["login-submit"].tap()
        XCTAssertTrue(app.buttons["账户"].waitForExistence(timeout: 10))
        app.tabBars.buttons["收藏"].tap(); XCTAssertTrue(row(app).waitForExistence(timeout: 5))
        app.buttons["账户"].tap(); app.buttons["退出登录"].tap()
        XCTAssertTrue(app.staticTexts["还没有收藏"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["登录"].exists)
    }

    func testDarkLargeTextAndBackground() {
        let app = launch(extra: ["-AppleInterfaceStyle", "Dark", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        XCTAssertTrue(row(app).waitForExistence(timeout: 10)); capture(app, "08-large-dark")
        row(app).tap(); XCTAssertTrue(app.staticTexts["detail-title"].waitForExistence(timeout: 5)); capture(app, "09-large-reading")
        XCUIDevice.shared.press(.home); app.activate()
        XCTAssertTrue(app.staticTexts["detail-title"].waitForExistence(timeout: 5))
        XCUIDevice.shared.orientation = .landscapeLeft
        capture(app, "10-landscape")
        XCUIDevice.shared.orientation = .portrait
    }
}


/// Opt-in production GET-only smoke check. Never part of ordinary fixture runs.
final class AquaSightLiveReadOnlyTests: XCTestCase {
    func testGuestCanReadLiveFeed() throws {
        guard ProcessInfo.processInfo.environment["AQUASIGHT_LIVE_READONLY"] == "1" else {
            throw XCTSkip("Requires explicit live read-only validation")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--preview-tab=reading", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.buttons["登录"].waitForExistence(timeout: 10), "Run only with a guest session")
        app.tabBars.buttons["订阅"].tap()
        if app.buttons["reader-starter"].exists { app.buttons["reader-starter"].tap(); app.buttons["save-subscriptions"].tap() }
        else { app.tabBars.buttons["阅读"].tap() }
        let item = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "event-")).firstMatch
        let loaded = item.waitForExistence(timeout: 35)
        let feedShot = XCTAttachment(screenshot: app.screenshot())
        feedShot.name = "12-live-opensource"; feedShot.lifetime = .keepAlways; add(feedShot)
        XCTAssertTrue(loaded, "Production feed must load on device")
        item.tap()
        XCTAssertTrue(app.staticTexts["detail-title"].waitForExistence(timeout: 15))
        let detailShot = XCTAttachment(screenshot: app.screenshot())
        detailShot.name = "13-live-detail"; detailShot.lifetime = .keepAlways; add(detailShot)
    }
}

/// Two real clients share a loopback HTTP service. The companion Playwright
/// script prepares Web state, then verifies and changes the native mutations.
final class AquaSightCrossClientTests: XCTestCase {
    @MainActor
    func testPasswordLoginAndBidirectionalWebSync() async throws {
        guard let base = ProcessInfo.processInfo.environment["AQUASIGHT_INTEGRATION_BASE"], base.hasPrefix("http://127.0.0.1:") else { throw XCTSkip("Opt-in loopback cross-client test") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestIntegration", "-uiTestResetStore", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["AQUASIGHT_INTEGRATION_BASE"] = base
        app.launch()
        XCTAssertTrue(app.buttons["登录"].firstMatch.waitForExistence(timeout: 15))
        app.buttons["登录"].firstMatch.tap()
        let email = app.textFields["login-email"], password = app.secureTextFields["login-password"]
        XCTAssertTrue(email.waitForExistence(timeout: 5)); email.tap(); email.typeText("cross-client@example.com")
        password.tap(); password.typeText("Reader-test-2026!")
        app.buttons["login-submit"].tap()
        XCTAssertTrue(app.buttons["账户"].waitForExistence(timeout: 20))
        app.tabBars.buttons["收藏"].tap()
        let web = app.descendants(matching: .any).matching(identifier: "event-cross-web").firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15), "Web favorite must appear in the native app")
        app.tabBars.buttons["阅读"].tap()
        let native = app.descendants(matching: .any).matching(identifier: "event-cross-ios").firstMatch
        XCTAssertTrue(native.waitForExistence(timeout: 15), "Web subscription must populate native reading")
        app.buttons["收藏 手机加入的阅读"].tap()
        app.tabBars.buttons["订阅"].tap()
        let source = app.buttons["source-huggingface"]
        for _ in 0..<5 {
            if source.exists && source.isHittable && source.frame.maxY < app.buttons["save-subscriptions"].frame.minY { break }
            app.swipeUp()
        }
        source.tap(); app.buttons["save-subscriptions"].tap()
        XCTAssertTrue(native.waitForExistence(timeout: 15))
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "cross-client-native"; shot.lifetime = .keepAlways; add(shot)
        var request = URLRequest(url: URL(string: base + "/__test__/phase?value=native-saved")!); request.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: request)
        var ready = false
        for _ in 0..<45 {
            let (data,_) = try await URLSession.shared.data(from: URL(string: base + "/__test__/phase")!)
            if String(data:data,encoding:.utf8)?.contains("web-updated") == true { ready = true; break }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        XCTAssertTrue(ready, "Companion browser must see and change the native data")
        XCUIDevice.shared.press(.home); app.activate()
        app.tabBars.buttons["收藏"].tap()
        // Poll using the UI so an old cached favorite cannot satisfy the test.
        for _ in 0..<15 { if !app.descendants(matching:.any).matching(identifier:"event-cross-ios").firstMatch.exists { break }; try await Task.sleep(nanoseconds:1_000_000_000) }
        XCTAssertFalse(app.descendants(matching:.any).matching(identifier:"event-cross-ios").firstMatch.exists)
        XCTAssertTrue(web.exists, "Unrelated favorite remains")
        app.buttons["账户"].tap(); app.buttons["退出登录"].tap()
        XCTAssertTrue(app.staticTexts["还没有收藏"].waitForExistence(timeout:10))
        request.url = URL(string:base + "/__test__/phase?value=complete")
        _ = try await URLSession.shared.data(for:request)
    }
}
