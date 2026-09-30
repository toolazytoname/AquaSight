import XCTest
@testable import AquaSight

/// URLProtocol-based stub so unit tests exercise the real APIClient encoding.
final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) async throws -> (HTTPURLResponse, Data))?
    static var lastRequest: URLRequest?
    static var requestCount = 0

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    private var work: Task<Void, Never>?
    override func startLoading() {
        var captured = request
        if captured.httpBody == nil, let stream = captured.httpBodyStream {
            stream.open(); defer { stream.close() }
            var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }; data.append(buffer, count: count)
            }
            captured.httpBody = data
        }
        Self.lastRequest = captured; Self.requestCount += 1
        let handler = Self.handler
        work = Task {
            do {
                guard let handler else { throw URLError(.badServerResponse) }
                let (response, data) = try await handler(captured)
                guard !Task.isCancelled else { return }
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
            } catch {
                if !Task.isCancelled { client?.urlProtocol(self, didFailWithError: error) }
            }
        }
    }
    override func stopLoading() { work?.cancel() }

    static func makeSession() -> URLSession {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: cfg)
    }

    static func ok(_ json: [String: Any], url: URL) -> (HTTPURLResponse, Data) {
        Self.json(status: 200, json, url: url)
    }

    static func json(status: Int, _ json: [String: Any], url: URL) -> (HTTPURLResponse, Data) {
        let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        let data = try! JSONSerialization.data(withJSONObject: json)
        return (resp, data)
    }
}

final class InMemoryTokenStore: TokenStore {
    var token: String?
    func save(_ token: String) { self.token = token }
    func read() -> String? { token }
    func clear() { token = nil }
}

// MARK: - URL construction / encoding

final class APIClientTests: XCTestCase {
    let base = URL(string: "https://quack.weichao.ren")!

    func client(store: TokenStore = InMemoryTokenStore()) -> APIClient {
        APIClient(base: base, tokenStore: store, session: StubURLProtocol.makeSession())
    }

    func testEventsQueryEncoding() async throws {
        let exp = expectation(description: "request made")
        StubURLProtocol.handler = { req in
            exp.fulfill()
            let url = req.url!
            XCTAssertEqual(url.host, "quack.weichao.ren")
            XCTAssertEqual(url.path, "/api/v1/events")
            let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)!
            // Chinese, spaces and & must arrive percent-encoded, decoded exactly once.
            let items = Dictionary(uniqueKeysWithValues: (comps.queryItems ?? []).map { ($0.name, $0.value ?? "") })
            XCTAssertEqual(items["view"], "featured")
            XCTAssertEqual(items["q"], "Swift 6 发布 & 更新")
            XCTAssertEqual(items["cursor"], "ab/cd+e==")
            return StubURLProtocol.ok(["items": [], "cursor": NSNull()], url: url)
        }
        let resp = try await client().events(view: "featured", q: "Swift 6 发布 & 更新", cursor: "ab/cd+e==")
        XCTAssertNil(resp.cursor)
        await fulfillment(of: [exp])
    }

    func testPathSegmentEncodedExactlyOnce() throws {
        let encoded = APIClient.encodePathSegment("evt:a b?x#%")
        let url = APIClient.buildURL(base: base, encodedPath: "/api/v1/events/\(encoded)", query: [])!
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(comps.percentEncodedPath, "/api/v1/events/\(encoded)", "pre-encoded path must not be re-escaped")
        XCTAssertEqual(url.path, "/api/v1/events/evt:a b?x#%")
        // And a normal id round-trips untouched.
        let plain = APIClient.buildURL(base: base, encodedPath: "/api/v1/events/\(APIClient.encodePathSegment("evt:2ff27037-2f0d-4ea6-b7fc-d12656f9cbde"))", query: [])!
        XCTAssertEqual(plain.path, "/api/v1/events/evt:2ff27037-2f0d-4ea6-b7fc-d12656f9cbde")
    }

    func testEventDetailPathEncoding() async throws {
        StubURLProtocol.handler = { req in
            XCTAssertEqual(URLComponents(url: req.url!, resolvingAgainstBaseURL: false)?.percentEncodedPath, "/api/v1/events/evt%3Adeepseek")
            return StubURLProtocol.ok(["item": ["id": "evt:deepseek", "title": "DeepSeek"]], url: req.url!)
        }
        let resp = try await client().event(id: "evt:deepseek")
        XCTAssertEqual(resp.item?.id, "evt:deepseek")
    }

    func testBearerAttachedOnlyWhenTokenPresent() async throws {
        let store = InMemoryTokenStore()
        store.token = "tok-123"
        StubURLProtocol.handler = { req in
            XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer tok-123")
            return StubURLProtocol.ok(["items": []], url: req.url!)
        }
        _ = try await client(store: store).favorites()
    }

    func testPublicEndpointsSendNoCredentialsForGuests() async throws {
        StubURLProtocol.handler = { req in
            XCTAssertNil(req.value(forHTTPHeaderField: "Authorization"), "guest must not send bearer")
            return StubURLProtocol.ok(["items": []], url: req.url!)
        }
        _ = try await client().events(view: "featured")
        _ = try await client().event(id: "x")
        _ = try await client().digest()
    }

    func testSessionConfigurationRefusesCookies() {
        let session = APIClient.makeDefaultSession()
        XCTAssertNil(session.configuration.httpCookieStorage)
        XCTAssertFalse(session.configuration.httpShouldSetCookies)
        XCTAssertEqual(session.configuration.httpCookieAcceptPolicy, .never)
    }

    func testErrorSurfacing() async {
        StubURLProtocol.handler = { req in
            StubURLProtocol.json(status: 401, ["error": "unauthorized"], url: req.url!)
        }
        do {
            _ = try await client().favorites()
            XCTFail("expected 401")
        } catch let e as APIError {
            XCTAssertEqual(e, .status(401, code: "unauthorized"))
            XCTAssertTrue(e.isUnauthorized)
        } catch {
            XCTFail("wrong error \(error)")
        }
    }
}

// MARK: - Tolerant decoding of REAL production payloads

final class LiveDecodeTests: XCTestCase {
    private func fixtureData(_ name: String) throws -> Data {
        let bundle = Bundle(for: Self.self)
        guard let url = bundle.url(forResource: name, withExtension: "json") else {
            throw NSError(domain: "Missing required fixture: \(name)", code: 1)
        }
        return try Data(contentsOf: url)
    }

    func testFeaturedProductionPayloadDecodes() throws {
        let resp = try JSONDecoder().decode(EventsResponse.self, from: fixtureData("featured"))
        let items = try XCTUnwrap(resp.items)
        XCTAssertFalse(items.isEmpty)
        let first = items[0]
        XCTAssertTrue(first.id.hasPrefix("evt:"))
        XCTAssertEqual(first.aiState, "ready")
        XCTAssertFalse(first.facts?.isEmpty ?? true)
        XCTAssertEqual(first.enrichInsufficient, false)
        XCTAssertFalse(first.safeLinks.isEmpty)
        // impact + attribution present in production
        XCTAssertNotNil(first.impact)
        XCTAssertNotNil(first.attribution)
        // Every link must be http(s) without credentials.
        for link in first.safeLinks {
            XCTAssertTrue(["http", "https"].contains(link.url.scheme?.lowercased() ?? ""))
            XCTAssertNil(link.url.user)
        }
    }

    func testOpensourceProductionPayloadDecodesGrowthArray() throws {
        let resp = try JSONDecoder().decode(EventsResponse.self, from: fixtureData("opensource"))
        let items = try XCTUnwrap(resp.items)
        XCTAssertFalse(items.isEmpty)
        for item in items {
            let repo = try XCTUnwrap(item.githubRepo, "opensource items carry githubRepo")
            // Production sends growth as an ARRAY (may be empty).
            XCTAssertNotNil(repo.growth)
            XCTAssertNotNil(repo.signals)
            if let stars = repo.stars { XCTAssertGreaterThan(stars, 0) }
        }
        // First row: 390583 stars, TypeScript, recent push, empty growth, 1 signal.
        let first = items[0]
        XCTAssertEqual(first.githubRepo?.stars, 390583)
        XCTAssertEqual(first.githubRepo?.language, "TypeScript")
        XCTAssertEqual(first.githubRepo?.growth?.count, 0)
        XCTAssertEqual(first.githubRepo?.signals?.count, 1)
        XCTAssertEqual(first.githubRepo?.pushedAt, "2026-09-26T23:03:33Z")
    }

    func testLatestProductionGrowthRowSemantics() throws {
        let resp = try JSONDecoder().decode(EventsResponse.self, from: fixtureData("latest"))
        let items = try XCTUnwrap(resp.items)
        let repoItem = try XCTUnwrap(items.first { $0.githubRepo?.growth?.isEmpty == false })
        let growth = try XCTUnwrap(repoItem.githubRepo?.growth?.first)
        // window "week" is a trending window label, NOT a date.
        XCTAssertEqual(growth.window, "week")
        XCTAssertEqual(growth.stars, 2623)
        XCTAssertEqual(growth.source, "github-trending-weekly")
        // Chinese window labels
        XCTAssertEqual(SourceCatalog.growthWindowLabel("week"), "本周")
        XCTAssertEqual(SourceCatalog.growthWindowLabel("day"), "今日")
    }

    func testDigestProductionMissingDecodes() throws {
        let resp = try JSONDecoder().decode(DigestResponse.self, from: fixtureData("digest"))
        let digest = try XCTUnwrap(resp.digest)
        XCTAssertEqual(digest.missing, true)
        XCTAssertEqual(digest.date, "2026-09-27")
        XCTAssertEqual(digest.items?.count, 0)
    }

    func testMinimalEventDecodes() throws {
        let json: [String: Any] = [
            "id": "card:deepseek", "title": "DeepSeek R1 发布", "url": "https://news.ycombinator.com/item?id=1",
            "source": "hn", "level": "breaking", "score": 11,
        ]
        let item = try JSONDecoder().decode(EventItem.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertNil(item.githubRepo)
        XCTAssertNil(item.facts)
        XCTAssertEqual(item.displayTitle, "DeepSeek R1 发布")
    }

    func testAIOverviewHonesty() throws {
        // AI-ready: overviewZh present and enrichment finished.
        let ready = EventItem(id: "a", title: "t", overviewZh: "中文概述", aiState: "ready", enrichInsufficient: false)
        XCTAssertTrue(ready.isAIReady)
        XCTAssertEqual(ready.overviewText, "中文概述")
        // Queued: English raw summary must not be labelled AI Chinese overview.
        let queued = EventItem(id: "b", title: "t", summary: "raw english", aiState: "queued", enrichInsufficient: true)
        XCTAssertFalse(queued.isAIReady)
        XCTAssertEqual(queued.overviewFallback, "raw english")
        // Insufficient flag blocks AI label even when overview exists.
        let thin = EventItem(id: "c", title: "t", overviewZh: "薄概述", enrichInsufficient: true)
        XCTAssertFalse(thin.isAIReady)
    }

    func testSafeLinkRejectsCredentialsAndNonHTTP() {
        XCTAssertNotNil(SafeLink(urlString: "https://example.com/a", title: ""))
        XCTAssertNotNil(SafeLink(urlString: "http://example.com/a", title: ""))
        XCTAssertNil(SafeLink(urlString: "javascript:alert(1)", title: ""))
        XCTAssertNil(SafeLink(urlString: "data:text/html,hi", title: ""))
        XCTAssertNil(SafeLink(urlString: "ftp://example.com", title: ""))
        XCTAssertNil(SafeLink(urlString: "https://user:pass@example.com", title: "creds"))
        XCTAssertNil(SafeLink(urlString: "not a url", title: ""))
    }

    func testSourceCatalogChineseLabels() {
        XCTAssertEqual(SourceCatalog.label("github-trending-weekly"), "GitHub 周榜")
        XCTAssertEqual(SourceCatalog.label("github-maintained"), "优质开源项目")
        XCTAssertEqual(SourceCatalog.label("36kr"), "36氪")
        XCTAssertEqual(SourceCatalog.label("unknown-source"), "unknown-source")
    }

    @MainActor func testDeepLinkParsing() {
        XCTAssertEqual(AquaSightApp.eventId(from: URL(string: "aquasight://event/evt-1")!), "evt-1")
        XCTAssertEqual(AquaSightApp.eventId(from: URL(string: "aquasight://events/evt%3A1")!), "evt:1")
        XCTAssertNil(AquaSightApp.eventId(from: URL(string: "aquasight://other/evt-1")!), "unknown host rejected")
        XCTAssertNil(AquaSightApp.eventId(from: URL(string: "aquasight://event/")!))
        // We never claim https/universal links.
        XCTAssertNil(AquaSightApp.eventId(from: URL(string: "https://quack.weichao.ren/#/event/evt-1")!))
        XCTAssertNil(AquaSightApp.eventId(from: URL(string: "mailto:x@y.z")!))
    }
}

extension APIClientTests {
    func testQueryPlusIsNotDecodedAsASpaceByServer() async throws {
        StubURLProtocol.handler = { request in
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.percentEncodedQuery!
            XCTAssertTrue(query.contains("C%2B%2B"))
            return StubURLProtocol.ok(["items": []], url: request.url!)
        }
        _ = try await client().events(view: "opensource", q: "C++ & Swift")
    }
    func testBoundClientCannotUseOrClearNewAccountToken() async throws {
        let store = InMemoryTokenStore(); store.token = "old"
        let bound = client(store: store).authenticated(token: store.token)
        store.token = "new"
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer old")
            XCTAssertFalse(request.httpShouldHandleCookies)
            return StubURLProtocol.ok(["ok": true], url: request.url!)
        }
        await bound.logout()
        XCTAssertEqual(store.token, "new")
    }
    func testMalformedFavoritesCannotBeAcceptedAsAnEmptyList() async throws {
        StubURLProtocol.handler = { request in StubURLProtocol.ok(["ok": true], url: request.url!) }
        do { _ = try await client().favorites(); XCTFail("missing items must fail") }
        catch { XCTAssertEqual(error as? APIError, .invalidResponse) }
    }
}

extension LiveDecodeTests {
    func testPendingAIIsNotLabelledCompleteAndDeepLinksDecodeOnce() {
        XCTAssertFalse(EventItem(id: "x", title: "x", overviewZh: "旧摘要", aiState: "queued").isAIReady)
    }
    @MainActor func testDeepLinkRejectsExtraPathAndPreservesLiteralEscapes() {
        XCTAssertNil(AquaSightApp.eventId(from: URL(string: "aquasight://event/a/b")!))
        XCTAssertNil(AquaSightApp.eventId(from: URL(string: "aquasight://user@event/a")!))
        XCTAssertEqual(AquaSightApp.eventId(from: URL(string: "aquasight://event/evt%3Aa%252Fb")!), "evt:a%2Fb")
    }
}

@MainActor
final class ReaderFlowTests: XCTestCase {
    private var directory: URL!
    private var token: InMemoryTokenStore!
    private var api: APIClient!
    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        token = InMemoryTokenStore()
        api = APIClient(base: URL(string: "https://example.com")!, tokenStore: token, session: StubURLProtocol.makeSession())
    }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: directory); StubURLProtocol.handler = nil }
    private static func catalog() -> [String: Any] {
        let sources = ReaderSource.basics + [.init(id: "bbc", label: "BBC", description: "国际动态", group: "更多来源", extended: true)]
        return ["sources": try! JSONSerialization.jsonObject(with: JSONEncoder().encode(sources))]
    }
    func testGuestStartsEmptyAndSelectionSurvivesRestartWithoutAccountLeak() async {
        let reader = ReaderModel(api: api, directory: directory)
        XCTAssertTrue(reader.effectiveSources.isEmpty)
        await reader.select(["openai", "invalid"])
        XCTAssertEqual(reader.effectiveSources, ["openai"])
        let guestKey = reader.scopeKey
        let restarted = ReaderModel(api: api, directory: directory)
        XCTAssertEqual(restarted.effectiveSources, ["openai"])
        restarted.activate(email: "other@example.com", token: "other")
        XCTAssertTrue(restarted.effectiveSources.isEmpty)
        XCTAssertNotEqual(restarted.scopeKey, guestKey)
        restarted.activate(email: nil, token: nil)
        XCTAssertEqual(restarted.effectiveSources, ["openai"])
    }
    func testRemoteExpansionOffPreservesSelectionButRemovesEffectiveSource() async {
        let reader = ReaderModel(api: api, directory: directory)
        reader.activate(email: "a@example.com", token: "a")
        var enabled = true
        StubURLProtocol.handler = { req in
            if req.url!.path.hasSuffix("catalog") { return StubURLProtocol.ok(Self.catalog(), url: req.url!) }
            return StubURLProtocol.ok(["reader": ["selectedSources": ["openai", "bbc"], "moreSourcesEnabled": enabled, "configured": true]], url: req.url!)
        }
        await reader.refresh()
        XCTAssertEqual(Set(reader.effectiveSources), ["openai", "bbc"])
        let oldScope = reader.scopeKey
        enabled = false; await reader.refresh()
        XCTAssertEqual(reader.effectiveSources, ["openai"])
        XCTAssertTrue(reader.settings.selectedSources.contains("bbc"))
        XCTAssertNotEqual(reader.scopeKey, oldScope)
    }
    func testPendingAccountSelectionRetriesWithoutChangingExpansionFlag() async {
        let reader = ReaderModel(api: api, directory: directory)
        reader.activate(email: "a@example.com", token: "a")
        StubURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        await reader.select(["openai"])
        XCTAssertTrue(reader.hasPendingChanges)
        let restarted = ReaderModel(api: api, directory: directory)
        restarted.activate(email: "a@example.com", token: "a")
        XCTAssertTrue(restarted.hasPendingChanges)
        StubURLProtocol.handler = { req in
            XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer a")
            if req.url!.path.hasSuffix("catalog") { return StubURLProtocol.ok(Self.catalog(), url: req.url!) }
            if req.httpMethod == "PUT" {
                let body = try JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
                XCTAssertNil(body["moreSourcesEnabled"])
                XCTAssertEqual(body["selectedSources"] as? [String], ["openai"])
            }
            return StubURLProtocol.ok(["reader": ["selectedSources": ["openai"], "moreSourcesEnabled": false, "configured": true]], url: req.url!)
        }
        await restarted.refresh()
        XCTAssertFalse(restarted.hasPendingChanges)
        XCTAssertEqual(restarted.effectiveSources, ["openai"])
    }
    func testLateSettingsResponseCannotOverwriteAnotherAccount() async {
        let reader = ReaderModel(api: api, directory: directory)
        reader.activate(email: "a@example.com", token: "a")
        let started = expectation(description: "request started")
        StubURLProtocol.handler = { req in
            started.fulfill()
            try await Task.sleep(nanoseconds: 150_000_000)
            return StubURLProtocol.ok(Self.catalog(), url: req.url!)
        }
        let request = Task { await reader.refresh() }
        await fulfillment(of: [started])
        reader.activate(email: "b@example.com", token: "b")
        await request.value
        XCTAssertEqual(reader.accountKey, LocalStore.accountKey(for: "b@example.com"))
        XCTAssertTrue(reader.settings.selectedSources.isEmpty)
        XCTAssertFalse(reader.isRefreshing)
    }
    func testCancelledRefreshDoesNotShowFalseOfflineWarning() async {
        let reader = ReaderModel(api: api, directory: directory)
        let started = expectation(description: "started")
        StubURLProtocol.handler = { req in
            started.fulfill()
            try await Task.sleep(nanoseconds: 2_000_000_000)
            return StubURLProtocol.ok(Self.catalog(), url: req.url!)
        }
        let task = Task { await reader.refresh() }
        await fulfillment(of: [started])
        task.cancel(); await task.value
        XCTAssertNil(reader.message)
        XCTAssertFalse(reader.isRefreshing)
    }
    func testOldServerCannotSilentlyReturnTheGlobalFeedAsSubscriptions() async {
        StubURLProtocol.handler = { req in StubURLProtocol.ok(["view": "reader", "items": []], url: req.url!) }
        do {
            _ = try await api.readerEvents(sources: ["openai"], q: "", cursor: nil)
            XCTFail("old endpoint without reader capability must not be accepted")
        } catch { XCTAssertEqual(error as? APIError, .readerUnavailable) }
    }
    func testReaderFeedFiltersUnselectedResponseAndKeepsSeparateCache() async {
        StubURLProtocol.handler = { req in
            XCTAssertEqual(URLComponents(url: req.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "view" }?.value, "reader")
            return StubURLProtocol.ok(["reader": true, "items": [["id": "yes", "title": "selected", "source": "openai", "url": "https://example.com/yes"], ["id": "no", "title": "unselected", "source": "bbc", "url": "https://example.com/no"]]], url: req.url!)
        }
        let feed = EventFeedModel(view: "reader", api: api, cacheDirectory: directory, readerSources: ["openai"], cacheKey: "a-openai")
        await feed.refresh()
        XCTAssertEqual(feed.items.map(\.id), ["yes"])
        let other = EventFeedModel(view: "reader", api: api, cacheDirectory: directory, readerSources: [], cacheKey: "b-empty")
        XCTAssertTrue(other.items.isEmpty)
    }
    func testUnselectedDeepLinkIsRejectedButPrivateSavedCopyRemainsReadable() async {
        StubURLProtocol.handler = { req in StubURLProtocol.ok(["item": ["id": "private", "title": "private", "source": "bbc"]], url: req.url!) }
        let model = DetailModel(api: api)
        await model.open(id: "private", fallback: nil, readerSources: [])
        XCTAssertNil(model.item)
        await model.open(id: "private", fallback: EventItem(id: "private", title: "saved"), readerSources: [], allowSaved: true)
        XCTAssertNotNil(model.item)
    }
}

@MainActor
final class LoginDeliveryTests: XCTestCase {
    func testUnavailableDeliveryDoesNotAdvanceOrStartCooldown() async {
        let token = InMemoryTokenStore()
        let api = APIClient(base: URL(string: "https://quack.weichao.ren")!, tokenStore: token, session: StubURLProtocol.makeSession())
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory); StubURLProtocol.handler = nil }
        let model = AppModel(api: api, keychain: token, storeDirectory: directory)
        StubURLProtocol.handler = { request in StubURLProtocol.ok(["ok": true, "delivery": "unavailable", "retryAfterSec": 60], url: request.url!) }
        let failed = await model.requestCode(email: "reader@example.com")
        XCTAssertFalse(failed.accepted); XCTAssertEqual(model.resendCooldown, 0)
        StubURLProtocol.handler = { request in StubURLProtocol.ok(["ok": true, "delivery": "sent", "retryAfterSec": 60], url: request.url!) }
        let sent = await model.requestCode(email: "reader@example.com")
        XCTAssertTrue(sent.accepted); XCTAssertEqual(model.resendCooldown, 60)
    }
    func testOldBackendIsNotReportedAsWrongPassword() async {
        let token = InMemoryTokenStore()
        let api = APIClient(base: URL(string: "https://quack.weichao.ren")!, tokenStore: token, session: StubURLProtocol.makeSession())
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory); StubURLProtocol.handler = nil }
        let model = AppModel(api: api, keychain: token, storeDirectory: directory)
        StubURLProtocol.handler = { request in StubURLProtocol.json(status: 401, ["error": "unauthorized"], url: request.url!) }
        let unavailable = await model.login(email: "reader@example.com", password: "Reader-test-2026!")
        XCTAssertTrue(unavailable?.contains("服务正在更新") == true)
        StubURLProtocol.handler = { request in StubURLProtocol.json(status: 401, ["error": "invalid-credentials"], url: request.url!) }
        let wrong = await model.login(email: "reader@example.com", password: "Reader-test-2026!")
        XCTAssertTrue(wrong?.contains("邮箱或密码不正确") == true)
    }
    func testAcknowledgedReadDoesNotResurrectAfterWebMarksItUnread() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalStore(accountKey: "reader", directory: directory)
        store.markRead("article")
        let sent = store.record.pendingReads
        store.adoptServerReads(sent, acknowledging: sent)
        XCTAssertTrue(store.record.pendingReads.isEmpty)
        store.adoptServerReads([:])
        XCTAssertFalse(store.isRead("article"))
        let reopened = LocalStore(accountKey: "reader", directory: directory)
        XCTAssertTrue(reopened.record.pendingReads.isEmpty)
        XCTAssertFalse(reopened.isRead("article"))
    }
    func testRemoteReadMarkersMergeWithoutLosingLocalReads() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalStore(accountKey: "reader", directory: directory)
        store.markRead("local")
        store.adoptServerReads(["web": "2026-09-28T00:00:00Z"])
        let reopened = LocalStore(accountKey: "reader", directory: directory)
        XCTAssertTrue(reopened.isRead("local")); XCTAssertTrue(reopened.isRead("web"))
    }
}
