import XCTest
@testable import AquaSight

// MARK: - Local store: favorites / tombstones / isolation / reconcile

final class LocalStoreTests: XCTestCase {
    var dir: URL!

    override func setUp() {
        super.setUp()
        dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("aquasight-tests-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
        super.tearDown()
    }

    private func item(_ id: String, title: String = "t") -> EventItem {
        EventItem(id: id, title: title)
    }

    func testSaveAndTombstone() {
        let store = LocalStore(accountKey: "a1", directory: dir)
        store.save(item("e1"))
        store.save(item("e2"))
        XCTAssertTrue(store.isSaved("e1"))
        XCTAssertEqual(store.savedItems.count, 2)

        store.remove(id: "e1")
        XCTAssertFalse(store.isSaved("e1"))
        XCTAssertEqual(store.tombstoneIds, ["e1"])

        // Tombstone survives relaunch (durable).
        let reopened = LocalStore(accountKey: "a1", directory: dir)
        XCTAssertEqual(reopened.tombstoneIds, ["e1"])
        XCTAssertTrue(reopened.isSaved("e2"))
    }

    func testSaveAfterDeleteClearsTombstone() {
        let store = LocalStore(accountKey: "a1", directory: dir)
        store.remove(id: "e1")
        XCTAssertEqual(store.tombstoneIds, ["e1"])
        store.save(item("e1"))
        XCTAssertTrue(store.tombstoneIds.isEmpty)
        XCTAssertTrue(store.isSaved("e1"))
    }

    func testMergeBodyContainsTombstonesAndSnapshots() throws {
        let store = LocalStore(accountKey: "a1", directory: dir)
        store.remove(id: "dead")
        store.save(item("alive"))
        store.markRead("alive")
        let body = store.mergeRequestBody()
        let deleted = body.favorites.filter { $0.deleted == true }
        let snapshots = body.favorites.filter { $0.deleted != true }
        XCTAssertEqual(deleted.map(\.id), ["dead"])
        XCTAssertEqual(snapshots.map(\.id), ["alive"])
        XCTAssertNotNil(body.reads["alive"])
    }

    func testAccountIsolation() {
        let alice = LocalStore(accountKey: "alice", directory: dir)
        let bob = LocalStore(accountKey: "bob", directory: dir)
        alice.save(item("a-only"))
        bob.save(item("b-only"))
        XCTAssertTrue(alice.isSaved("a-only"))
        XCTAssertFalse(alice.isSaved("b-only"), "one account's snapshot must not leak into another")
        XCTAssertTrue(bob.isSaved("b-only"))
        XCTAssertFalse(bob.isSaved("a-only"))

        alice.remove(id: "a-only")
        XCTAssertFalse(alice.isSaved("a-only"))
        XCTAssertTrue(bob.isSaved("b-only"))
    }

    func testAccountKeyNormalisation() {
        XCTAssertEqual(LocalStore.accountKey(for: nil), "guest")
        XCTAssertEqual(LocalStore.accountKey(for: "  "), "guest")
        let k1 = LocalStore.accountKey(for: "user@example.com")
        XCTAssertNotEqual(k1, LocalStore.accountKey(for: "other@example.com"))
        XCTAssertNotEqual(k1, "guest")
        XCTAssertEqual(k1, LocalStore.accountKey(for: "USER@EXAMPLE.COM"))
    }

    func testLatestToggleSurvivesOlderInFlightAcknowledgement() throws {
        let store = LocalStore(accountKey: "a1", directory: dir)
        store.save(item("e1"), enqueue: true)
        let inFlight = try XCTUnwrap(store.pendingOps.first)
        store.remove(id: "e1", enqueue: true)
        store.save(item("e1", title: "again"), enqueue: true)
        store.acknowledge(inFlight)
        let reopened = LocalStore(accountKey: "a1", directory: dir)
        XCTAssertEqual(reopened.pendingOps.count, 1)
        XCTAssertEqual(reopened.pendingOps.first?.kind, .save)
        XCTAssertEqual(reopened.pendingOps.first?.snapshot?.title, "again")
        XCTAssertTrue(reopened.isSaved("e1"))
        XCTAssertFalse(reopened.hasTombstone("e1"))
    }

    func testPendingOpsSurviveRelaunch() {
        let store = LocalStore(accountKey: "a1", directory: dir)
        store.enqueueSave(item("e1"))
        store.enqueueDelete(id: "e2")
        let reopened = LocalStore(accountKey: "a1", directory: dir)
        XCTAssertEqual(reopened.pendingOps.count, 2)
    }

    func testAdoptServerFavoritesRespectsTombstonesAndPendingSaves() {
        let store = LocalStore(accountKey: "a1", directory: dir)
        store.save(item("e1"))
        store.save(item("e2"))
        store.remove(id: "e1")               // pending delete
        store.save(item("e3"), enqueue: true)
        store.enqueueSave(item("e4"))        // pending save (never on server)

        // Server still lists e1 and e2 (delete not applied); brings e5.
        store.adoptServerFavorites([item("e1"), item("e2"), item("e5")])

        XCTAssertFalse(store.isSaved("e1"), "local tombstone must win until the delete drains")
        XCTAssertTrue(store.hasTombstone("e1"), "tombstone kept as durable no-resurrect guarantee")
        XCTAssertTrue(store.isSaved("e2"))
        XCTAssertTrue(store.isSaved("e3"), "offline-only snapshot stays visible")
        XCTAssertTrue(store.isSaved("e4"), "pending save stays visible")
        XCTAssertTrue(store.isSaved("e5"))
    }

    func testAdoptServerFavoritesDedupesDefensively() {
        let store = LocalStore(accountKey: "a1", directory: dir)
        // Duplicate rows in the server list must not trap (Dictionary(uniqueKeys:)).
        store.adoptServerFavorites([item("x"), item("x", title: "dup")])
        XCTAssertEqual(store.savedItems.count, 1)
    }

    func testMergeOwnerQuarantine() {
        let store = LocalStore(accountKey: "guest", directory: dir)
        store.save(item("g1"))
        store.claimMergeOwner("a@example.com")
        XCTAssertEqual(store.mergeOwnerEmail, "a@example.com")
        // Claim is sticky: a second account cannot steal the guest payload.
        store.claimMergeOwner("b@example.com")
        XCTAssertEqual(store.mergeOwnerEmail, "a@example.com")

        let reopened = LocalStore(accountKey: "guest", directory: dir)
        XCTAssertEqual(reopened.mergeOwnerEmail, "a@example.com")
        reopened.wipe()
        XCTAssertNil(reopened.mergeOwnerEmail)
        XCTAssertTrue(reopened.isEmptyForTransfer)
    }
}

// MARK: - Feed: races / cache / pagination / digest

@MainActor
final class FeedModelTests: XCTestCase {
    var dir: URL!

    override func setUp() {
        super.setUp()
        dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("aquasight-feed-\(UUID().uuidString)", isDirectory: true)
        StubURLProtocol.handler = nil
        StubURLProtocol.requestCount = 0
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
        super.tearDown()
    }

    private func makeFeed(view: String = "featured") -> EventFeedModel {
        let api = APIClient(base: URL(string: "https://quack.weichao.ren")!,
                            tokenStore: InMemoryTokenStore(),
                            session: StubURLProtocol.makeSession())
        return EventFeedModel(view: view, api: api, cacheDirectory: dir)
    }

    func testStaleResponseDoesNotOverwriteNewer() async throws {
        let gate = AsyncGate()
        var call = 0
        StubURLProtocol.handler = { req in
            call += 1
            let url = req.url!
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                .first { $0.name == "q" }?.value ?? ""
            if call == 1 {
                try await gate.wait()   // slow old query response
                return StubURLProtocol.ok(["items": [["id": "old", "title": q]]], url: url)
            }
            return StubURLProtocol.ok(["items": [["id": "new", "title": q]]], url: url)
        }
        let feed = makeFeed()

        async let first: Void = feed.refresh()
        try await Task.sleep(nanoseconds: 100_000_000)
        feed.setQuery("更新")                    // invalidates in-flight immediately
        async let second: Void = feed.refresh()
        try await Task.sleep(nanoseconds: 100_000_000)
        gate.open()
        _ = await (first, second)

        XCTAssertEqual(feed.items.map(\.id), ["new"], "late old response must not replace newer results")
    }

    func testSearchDoesNotPoisonUnfilteredCache() async throws {
        StubURLProtocol.handler = { req in
            let url = req.url!
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                .first { $0.name == "q" }?.value
            if q == nil {
                return StubURLProtocol.ok(["items": [["id": "full", "title": "全部"]]], url: url)
            }
            return StubURLProtocol.ok(["items": [["id": "hit", "title": "命中"]]], url: url)
        }
        let feed = makeFeed()
        await feed.refresh()
        feed.setQuery("命中")
        try await Task.sleep(nanoseconds: 600_000_000)   // debounce
        await feed.refresh()
        XCTAssertEqual(feed.items.map(\.id), ["hit"])

        // A fresh model over the same cache dir must see the FULL list.
        let reloaded = makeFeed()
        XCTAssertEqual(reloaded.items.map(\.id), ["full"], "search results must not replace the canonical cache")
    }

    func testCachedFeedStillRefreshesOnAppear() async throws {
        var loads = 0
        StubURLProtocol.handler = { req in
            loads += 1
            return StubURLProtocol.ok(["items": [["id": "v\(loads)", "title": "t"]]], url: req.url!)
        }
        let feed = makeFeed()
        await feed.refresh()
        XCTAssertEqual(loads, 1)
        // Simulate tab re-appear after the 60s throttle window.
        try await Task.sleep(nanoseconds: 50_000_000)
        let cached = makeFeed()
        XCTAssertEqual(cached.items.first?.id, "v1")
        cached.refreshIfStale()
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertGreaterThanOrEqual(loads, 2, "cached items must still refresh")
        XCTAssertEqual(cached.items.first?.id, "v\(loads)")
    }

    func testPaginationDedupesIdsAndEnds() async throws {
        StubURLProtocol.handler = { req in
            let url = req.url!
            let cursor = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                .first { $0.name == "cursor" }?.value
            if cursor == nil {
                return StubURLProtocol.ok(["items": [["id": "a", "title": "A"]], "cursor": "pg2"], url: url)
            }
            // Server echoes an overlapping item.
            return StubURLProtocol.ok(["items": [["id": "a", "title": "A"], ["id": "b", "title": "B"]], "cursor": NSNull()], url: url)
        }
        let feed = makeFeed()
        await feed.refresh()
        await feed.loadMoreIfNeeded(current: EventItem(id: "a", title: "A"))
        XCTAssertEqual(feed.items.map(\.id), ["a", "b"], "duplicate ids across pages must be dropped")
        if case .loaded(let end) = feed.phase { XCTAssertTrue(end) } else { XCTFail("phase \(feed.phase)") }
    }

    func testPageFailureKeepsItemsWithWarning() async throws {
        var call = 0
        StubURLProtocol.handler = { req in
            call += 1
            if call == 1 {
                return StubURLProtocol.ok(["items": [["id": "a", "title": "A"]], "cursor": "pg2"], url: req.url!)
            }
            return StubURLProtocol.json(status: 503, ["error": "unavailable"], url: req.url!)
        }
        let feed = makeFeed()
        await feed.refresh()
        await feed.loadMoreIfNeeded(current: EventItem(id: "a", title: "A"))
        XCTAssertEqual(feed.items.map(\.id), ["a"], "prior content survives a page failure")
        XCTAssertNotNil(feed.warning, "a retryable warning must surface")
    }

    func testFirstLoadFailureShowsRetryableError() async throws {
        StubURLProtocol.handler = { req in
            StubURLProtocol.json(status: 502, ["error": "bad gateway"], url: req.url!)
        }
        let feed = makeFeed()
        await feed.refresh()
        guard case .failed = feed.phase else { return XCTFail("expected failure phase") }
    }

    func testFastFailureIsNotRetriedByDuplicateAppearanceButManualRetryWorks() async throws {
        var requests = 0
        StubURLProtocol.handler = { req in
            requests += 1
            if requests == 1 {
                return StubURLProtocol.json(status: 503, ["error": "unavailable"], url: req.url!)
            }
            return StubURLProtocol.ok(["items": [["id": "recovered", "title": "恢复"]]], url: req.url!)
        }
        let feed = makeFeed()
        await feed.refresh()
        guard case .failed = feed.phase else { return XCTFail("expected first failure") }
        feed.refreshIfStale() // Late scene-active callback after a fast failed load.
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(requests, 1, "automatic callbacks must preserve the retry state")
        await feed.retry()
        XCTAssertEqual(requests, 2)
        XCTAssertEqual(feed.items.first?.id, "recovered")
    }

    func testDigestMissingFlagAndLocalFilter() async throws {
        StubURLProtocol.handler = { req in
            let digest: [String: Any] = [
                "date": EventFeedModel.beijingDay(),
                "items": [
                    ["id": "dg-1", "title": "one", "titleZh": "一", "overviewZh": "甲", "source": "hn"],
                    ["id": "dg-2", "title": "two", "titleZh": "二", "overviewZh": "乙", "source": "36kr"],
                ],
                "tech": [["id": "dg-1", "title": "one", "titleZh": "一", "overviewZh": "甲", "source": "hn"]],
                "business": [], "public": [],
            ]
            return StubURLProtocol.ok(["digest": digest], url: req.url!)
        }
        let feed = makeFeed(view: "digest")
        await feed.refresh()
        XCTAssertFalse(feed.digestMissing)
        XCTAssertEqual(feed.items.count, 2)
        XCTAssertEqual(feed.digestDate, EventFeedModel.beijingDay())
    }

    func testOldDigestCacheNotReusedForToday() async throws {
        // Write a cache for a different digest date; it must not be shown.
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let cacheFile = dir.appendingPathComponent("digest.json")
        let stale = ["items": [["id": "old", "title": "旧"]], "savedAt": 1.0, "digestDate": "2000-01-01", "digestMissing": false] as [String: Any]
        try JSONSerialization.data(withJSONObject: stale).write(to: cacheFile)
        let feed = makeFeed(view: "digest")
        XCTAssertTrue(feed.items.isEmpty, "yesterday's digest must not load as today's")
    }
}

// MARK: - AppModel: auth retention, guest merge, mutation ordering, races

@MainActor
final class AppModelSyncTests: XCTestCase {
    var dir: URL!
    var tokens: InMemoryTokenStore!

    override func setUp() {
        super.setUp()
        dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("aquasight-appmodel-\(UUID().uuidString)", isDirectory: true)
        tokens = InMemoryTokenStore()
        StubURLProtocol.handler = nil
        StubURLProtocol.requestCount = 0
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
        AccountIdentityStore.clear(directory: dir)
        super.tearDown()
    }

    private func makeModel(token: String? = nil) -> AppModel {
        tokens.token = token
        let api = APIClient(base: URL(string: "https://quack.weichao.ren")!,
                            tokenStore: tokens,
                            session: StubURLProtocol.makeSession())
        return AppModel(api: api, keychain: tokens, storeDirectory: dir)
    }

    private static func mergeOK(favorites: [[String: Any]] = []) -> [String: Any] {
        ["ok": true, "favorites": favorites, "items": [], "reads": [:], "apiVersion": "v1"]
    }

    func testOfflineLaunchRetainsTokenAndAccountCache() async throws {
        // Seed an account store with a cached favorite + identity + token.
        let email = "user@example.com"
        let store = LocalStore(accountKey: LocalStore.accountKey(for: email), directory: dir)
        store.save(EventItem(id: "cached-1", title: "缓存"))
        AccountIdentityStore.save(email: email, directory: dir)

        StubURLProtocol.handler = { req in
            // /me fails with a network error (offline), NOT 401.
            throw URLError(.notConnectedToInternet)
        }
        let model = makeModel(token: "tok")
        await model.restoreSession()

        XCTAssertEqual(model.auth, .loggedIn(email: email), "transient /me failure keeps the account state")
        XCTAssertEqual(tokens.token, "tok", "token must survive an offline launch")
        XCTAssertTrue(model.isSaved("cached-1"), "account cached favorites stay readable offline")
    }

    func testExpiredSessionDropsToGuest() async throws {
        AccountIdentityStore.save(email: "user@example.com", directory: dir)
        StubURLProtocol.handler = { req in
            StubURLProtocol.json(status: 401, ["error": "unauthorized"], url: req.url!)
        }
        let model = makeModel(token: "tok")
        await model.restoreSession()
        XCTAssertEqual(model.auth, .guest)
        XCTAssertNil(tokens.token)
        XCTAssertNil(AccountIdentityStore.read(directory: dir))
    }

    func testGuestMergeTransfersOnceAndQuarantinesToFirstAccount() async throws {
        // Guest has a favorite before login.
        let model = makeModel()
        model.save(EventItem(id: "g1", title: "游客收藏"))
        XCTAssertTrue(model.isSaved("g1"))
        XCTAssertTrue(model.store.pendingOps.isEmpty, "guest performs no server mutations")

        var merges: [[String: Any]] = []
        StubURLProtocol.handler = { req in
            let url = req.url!
            switch (req.httpMethod ?? "GET", url.path) {
            case ("POST", "/api/v1/auth/verify"):
                return StubURLProtocol.ok(["ok": true, "token": "t-a", "user": ["id": "u1", "email": "a@example.com"]], url: url)
            case ("POST", "/api/v1/sync/merge"):
                let body = (try? JSONSerialization.jsonObject(with: req.httpBody ?? Data())) as? [String: Any] ?? [:]
                merges.append(body)
                return StubURLProtocol.ok(Self.mergeOK(favorites: [["eventId": "g1", "snapshot": ["id": "g1", "title": "游客收藏"], "rev": 1]]), url: url)
            case ("GET", "/api/v1/favorites"):
                return StubURLProtocol.ok(["items": [["id": "g1", "title": "游客收藏"]]], url: url)
            default:
                return StubURLProtocol.ok(["ok": true], url: url)
            }
        }

        let error = await model.verify(email: "a@example.com", code: "123456")
        XCTAssertNil(error)
        XCTAssertEqual(model.auth, .loggedIn(email: "a@example.com"))
        XCTAssertTrue(model.isSaved("g1"), "guest favorite transferred into the account")

        // Guest payload wiped after successful transfer.
        let guestStore = LocalStore(accountKey: LocalStore.accountKey(for: nil), directory: dir)
        XCTAssertTrue(guestStore.isEmptyForTransfer)

        // The merge request contained the guest favorite.
        let favs = merges.first?["favorites"] as? [[String: Any]] ?? []
        XCTAssertTrue(favs.contains { ($0["id"] as? String) == "g1" })
    }

    func testFailedGuestMergeDoesNotLeakIntoSecondAccount() async throws {
        let model = makeModel()
        model.save(EventItem(id: "g1", title: "游客收藏"))

        let mergeFailing = true
        StubURLProtocol.handler = { req in
            let url = req.url!
            switch (req.httpMethod ?? "GET", url.path) {
            case ("POST", "/api/v1/auth/verify"):
                let body = (try? JSONSerialization.jsonObject(with: req.httpBody ?? Data())) as? [String: Any] ?? [:]
                let email = body["email"] as? String ?? ""
                return StubURLProtocol.ok(["ok": true, "token": "t-\(email)", "user": ["id": "u", "email": email]], url: url)
            case ("POST", "/api/v1/sync/merge"):
                if mergeFailing {
                    throw URLError(.notConnectedToInternet)
                }
                return StubURLProtocol.ok(Self.mergeOK(), url: url)
            case ("GET", "/api/v1/favorites"):
                return StubURLProtocol.ok(["items": []], url: url)
            default:
                return StubURLProtocol.ok(["ok": true], url: url)
            }
        }

        // First login (account A): OTP ok, merge fails.
        _ = await model.verify(email: "a@example.com", code: "123456")
        XCTAssertEqual(model.auth, .loggedIn(email: "a@example.com"))
        // Guest payload retained for retry, but claimed by A only.
        let guestStore = LocalStore(accountKey: LocalStore.accountKey(for: nil), directory: dir)
        XCTAssertEqual(guestStore.mergeOwnerEmail, "a@example.com")
        XCTAssertFalse(guestStore.isEmptyForTransfer)

        // Second login (account B): guest payload must NOT transfer.
        var bMerges: [[String: Any]] = []
        StubURLProtocol.handler = { req in
            let url = req.url!
            if url.path == "/api/v1/sync/merge" {
                let body = (try? JSONSerialization.jsonObject(with: req.httpBody ?? Data())) as? [String: Any] ?? [:]
                bMerges.append(body)
            }
            if url.path == "/api/v1/auth/verify" {
                let body = (try? JSONSerialization.jsonObject(with: req.httpBody ?? Data())) as? [String: Any] ?? [:]
                let email = body["email"] as? String ?? ""
                return StubURLProtocol.ok(["ok": true, "token": "t-b", "user": ["id": "u", "email": email]], url: url)
            }
            return StubURLProtocol.ok(Self.mergeOK(), url: url)
        }
        _ = await model.verify(email: "b@example.com", code: "123456")
        XCTAssertEqual(model.auth, .loggedIn(email: "b@example.com"))
        let bFavs = bMerges.flatMap { ($0["favorites"] as? [[String: Any]]) ?? [] }
        XCTAssertFalse(bFavs.contains { ($0["id"] as? String) == "g1" },
                       "quarantined guest payload must never leak into a second account")
        // B sees no ghost of guest data.
        XCTAssertFalse(model.isSaved("g1"))
    }

    func testOfflineMutationsRetryAfterFailure() async throws {
        StubURLProtocol.handler = { req in
            let url = req.url!
            if url.path == "/api/v1/auth/verify" {
                return StubURLProtocol.ok(["ok": true, "token": "t", "user": ["id": "u1", "email": "a@example.com"]], url: url)
            }
            if url.path == "/api/v1/favorites" && req.httpMethod == "POST" {
                throw URLError(.notConnectedToInternet)
            }
            return StubURLProtocol.ok(Self.mergeOK(), url: url)
        }
        let model = makeModel()
        _ = await model.verify(email: "a@example.com", code: "123456")

        model.save(EventItem(id: "e1", title: "离线收藏"))
        XCTAssertTrue(model.isSaved("e1"), "local truth applies immediately")
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(model.store.pendingOps.count, 1, "failed op stays queued")

        // Network heals: a sync drains the queue.
        var saved = false
        StubURLProtocol.handler = { req in
            let url = req.url!
            if url.path == "/api/v1/favorites", req.httpMethod == "POST" {
                saved = true
                return StubURLProtocol.ok(["ok": true, "rev": 1], url: url)
            }
            return StubURLProtocol.ok(Self.mergeOK(), url: url)
        }
        await model.syncNow(showNotice: false)
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertTrue(saved)
        XCTAssertTrue(model.store.pendingOps.isEmpty)
    }

    func testAccountSwitchDuringMutationAbortsOldQueue() async throws {
        // Login as A, enqueue a slow save, then log out before it completes.
        let gate = AsyncGate()
        StubURLProtocol.handler = { req in
            let url = req.url!
            if url.path == "/api/v1/auth/verify" {
                return StubURLProtocol.ok(["ok": true, "token": "t", "user": ["id": "u1", "email": "a@example.com"]], url: url)
            }
            if url.path == "/api/v1/favorites", req.httpMethod == "POST" {
                try await gate.wait()
                return StubURLProtocol.ok(["ok": true, "rev": 1], url: url)
            }
            return StubURLProtocol.ok(Self.mergeOK(), url: url)
        }
        let model = makeModel()
        _ = await model.verify(email: "a@example.com", code: "123456")
        model.save(EventItem(id: "e1", title: "A 的收藏"))
        try await Task.sleep(nanoseconds: 150_000_000)

        // Logout mid-flight bumps the generation.
        await model.logout()
        XCTAssertEqual(model.auth, .guest)
        gate.open()
        try await Task.sleep(nanoseconds: 300_000_000)

        // The op was pushed back into A's store, never applied to the guest.
        XCTAssertEqual(model.auth, .guest)
        let aStore = LocalStore(accountKey: LocalStore.accountKey(for: "a@example.com"), directory: dir)
        XCTAssertEqual(aStore.pendingOps.count, 1, "op returned to the captured store")
        XCTAssertFalse(model.isSaved("e1"), "guest store untouched")
        XCTAssertEqual(tokens.token, nil, "token cleared once")
    }

    func testGuestNeverSendsMutations() async throws {
        var sawMutation = false
        StubURLProtocol.handler = { req in
            let url = req.url!
            if url.path.hasPrefix("/api/v1/favorites") || url.path == "/api/v1/reads" {
                sawMutation = true
            }
            return StubURLProtocol.ok(Self.mergeOK(), url: url)
        }
        let model = makeModel()
        model.save(EventItem(id: "g1", title: "游客"))
        model.unsave(id: "g1")
        model.markRead("g1")
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertFalse(sawMutation, "guest performs zero unauthorized mutations")
    }
}

/// One-shot response gate; suspends instead of blocking the executor.
final class AsyncGate: @unchecked Sendable {
    private let lock = NSLock()
    private var isOpen = false
    private var waiter: CheckedContinuation<Void, Never>?
    func open() {
        lock.lock(); isOpen = true; let current = waiter; waiter = nil; lock.unlock()
        current?.resume()
    }
    func wait() async throws {
        await withCheckedContinuation { continuation in
            lock.lock()
            if isOpen { lock.unlock(); continuation.resume() }
            else { waiter = continuation; lock.unlock() }
        }
    }
}

extension AppModelSyncTests {
    func testFailedAccountDeletePreservesDataAndSuccessOnlyRemovesCurrentAccount() async throws {
        let other = LocalStore(accountKey: LocalStore.accountKey(for: "b@example.com"), directory: dir)
        other.save(EventItem(id: "b", title: "B 的收藏"))
        var deleteFails = true
        StubURLProtocol.handler = { req in
            let url = req.url!
            if url.path == "/api/v1/auth/verify" { return StubURLProtocol.ok(["token": "a-token", "user": ["email": "a@example.com"]], url: url) }
            if url.path == "/api/v1/me", req.httpMethod == "DELETE", deleteFails {
                return StubURLProtocol.json(status: 503, ["error": "unavailable"], url: url)
            }
            if url.path == "/api/v1/favorites" { return StubURLProtocol.ok(["items": [["id": "a", "title": "A 的收藏"]]], url: url) }
            return StubURLProtocol.ok(Self.mergeOK(), url: url)
        }
        let model = makeModel()
        _ = await model.verify(email: "a@example.com", code: "123456")
        XCTAssertTrue(model.isSaved("a"))
        await model.deleteAccountAndWipeLocalData()
        XCTAssertEqual(model.auth, .loggedIn(email: "a@example.com"))
        XCTAssertTrue(model.isSaved("a"))
        XCTAssertTrue(model.notice?.contains("未删除") == true)
        deleteFails = false
        await model.deleteAccountAndWipeLocalData()
        XCTAssertEqual(model.auth, .guest)
        XCTAssertTrue(LocalStore(accountKey: other.accountKey, directory: dir).isSaved("b"))
        XCTAssertFalse(LocalStore(accountKey: LocalStore.accountKey(for: "a@example.com"), directory: dir).isSaved("a"))
    }

    func testAccountSyncDoesNotResurrectFavoriteDeletedOnAnotherDevice() async throws {
        let local = LocalStore(accountKey: LocalStore.accountKey(for: "a@example.com"), directory: dir)
        local.save(EventItem(id: "removed-remotely", title: "旧收藏"))
        StubURLProtocol.handler = { req in
            if req.url!.path == "/api/v1/auth/verify" { return StubURLProtocol.ok(["token": "a", "user": ["email": "a@example.com"]], url: req.url!) }
            if req.url!.path == "/api/v1/sync/merge" {
                let json = try JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
                XCTAssertEqual((json["favorites"] as? [Any])?.count, 0)
            }
            return StubURLProtocol.ok(Self.mergeOK(), url: req.url!)
        }
        let model = makeModel()
        _ = await model.verify(email: "a@example.com", code: "123456")
        XCTAssertFalse(model.isSaved("removed-remotely"))
    }

    func testFailedGuestTransferRetriesForItsOwner() async throws {
        var fail = true, transferred = false
        StubURLProtocol.handler = { req in
            let url = req.url!
            if url.path == "/api/v1/auth/verify" { return StubURLProtocol.ok(["token": "a", "user": ["email": "a@example.com"]], url: url) }
            if url.path == "/api/v1/sync/merge" {
                if fail { throw URLError(.notConnectedToInternet) }
                let json = try JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
                transferred = (json["favorites"] as? [[String: Any]])?.contains { $0["id"] as? String == "guest" } == true
            }
            if url.path == "/api/v1/favorites" { return StubURLProtocol.ok(["items": [["id": "guest", "title": "Guest"]]], url: url) }
            return StubURLProtocol.ok(Self.mergeOK(), url: url)
        }
        let model = makeModel(); model.save(EventItem(id: "guest", title: "Guest"))
        _ = await model.verify(email: "a@example.com", code: "123456")
        XCTAssertTrue(model.guestHasPendingTransfer)
        fail = false
        await model.syncNow()
        XCTAssertTrue(transferred)
        XCTAssertTrue(model.isSaved("guest"))
        XCTAssertFalse(model.guestHasPendingTransfer)
    }
}
