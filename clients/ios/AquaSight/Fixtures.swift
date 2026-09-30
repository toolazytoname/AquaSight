#if DEBUG
import Foundation

/// Deterministic in-process fixtures for unit + UI tests. Registered only in
/// DEBUG builds when the app launches with `-uiTestFixtures`. Nothing leaves
/// the process: OTP is never really requested, no live mutations occur.
final class FixturesURLProtocol: URLProtocol {
    /// When set, the first /api/v1/events GET fails (retry then succeeds).
    static var forceErrorOnce = false
    private static var errorConsumed = false
    private static let queue = DispatchQueue(label: "aquasight.fixtures")

    static let serverState = ServerState()

    final class ServerState {
        var reader = ReaderSettings()
        var favorites: [String: EventItem] = [:]
        var deleted: Set<String> = []
        var reads: [String: String] = [:]
        var token: String?
        var email: String?
        var delay: TimeInterval = 0
        var requests: [(String, String)] = []
    }

    static func reset() {
        let state = ServerState()
        state.delay = serverState.delay
        serverState.reader = ReaderSettings()
        serverState.favorites = [:]
        serverState.deleted = []
        serverState.reads = [:]
        serverState.token = nil
        serverState.email = nil
        serverState.requests = []
        errorConsumed = false
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let req = request
        Self.queue.async { [weak self] in
            guard let self else { return }
            if FixturesURLProtocol.serverState.delay > 0 {
                Thread.sleep(forTimeInterval: FixturesURLProtocol.serverState.delay)
            }
            self.respond(to: req)
        }
    }

    override func stopLoading() {}

    // MARK: Fixture data (mirrors production /tmp/aquasight-ios-live shapes)

    static func fixtureItems() -> [[String: Any]] {
        let list: [[String: Any]] = [
            [
                "id": "evt-alpha", "title": "Swift 6.2 released", "titleZh": "Swift 6.2 正式发布",
                "url": "https://example.com/swift62", "source": "hn", "level": "breaking",
                "summary": "Concurrency improvements ship.",
                "overviewZh": "Swift 6.2 发布，并发模型进一步简化，迁移成本降低。",
                "aiState": "ready", "enrichInsufficient": false,
                "facts": ["语言层面新增可选导入", "并发互操作改进"],
                "impact": "可能降低大型 Swift 项目的迁移成本。",
                "publishedAt": "2026-09-25T10:00:00.000Z",
                "sources": [["source": "hn", "url": "https://example.com/swift62", "title": "Swift 6.2 正式发布"]],
            ],
            [
                "id": "evt-beta", "title": "DuckLake announced", "titleZh": "DuckLake 湖仓格式公布",
                "url": "https://example.com/ducklake", "source": "36kr", "level": "normal",
                "summaryZh": "DuckLake 公布开放湖仓格式，面向分析场景。",
                "aiState": "pending", "enrichInsufficient": true,
                "facts": ["基于 SQLite 目录 + Parquet 数据"],
                "publishedAt": "2026-09-24T08:30:00.000Z",
            ],
            [
                "id": "evt-gamma", "title": "Vision update", "titleZh": "视觉模型更新",
                "url": "https://example.com/vision", "source": "openai", "level": "normal",
                "overviewZh": "多模态视觉模型更新，小模型能力提升。",
                "aiState": "ready", "enrichInsufficient": false,
                "publishedAt": "2026-09-23T12:00:00.000Z",
            ],
        ]
        return list
    }

    static func repoItems() -> [[String: Any]] {
        [
            [
                "id": "repo-one", "title": "duckdb/duckdb", "url": "https://github.com/duckdb/duckdb",
                "source": "github-maintained", "kind": "maintained-repo",
                "githubRepo": [
                    "fullName": "duckdb/duckdb", "language": "TypeScript", "stars": 390583,
                    "license": "MIT", "pushedAt": "2026-09-25T09:00:00.000Z",
                    "observedAt": "2026-09-26T01:00:00.000Z",
                    "signal": "近 60 天有提交 · 30000 star · 非 fork、未归档",
                    "signals": [["source": "github-maintained", "signal": "近 60 天有提交 · 30000 star"]],
                    "growth": [],
                ] as [String: Any],
            ],
            [
                "id": "repo-two", "title": "some/trending", "url": "https://github.com/some/trending",
                "source": "github-trending-weekly",
                "githubRepo": [
                    "fullName": "some/trending", "language": "Rust", "stars": 1200,
                    "pushedAt": "2026-09-26T00:00:00.000Z", "observedAt": "2026-09-26T02:00:00.000Z",
                    "signals": [["source": "github-trending-weekly", "signal": "本周 GitHub Trending +340 star"]],
                    "growth": [["source": "github-trending-weekly", "window": "week", "stars": 340]],
                ] as [String: Any],
            ],
        ]
    }

    static func digestFixture() -> [String: Any] {
        [
            "date": beijingToday(),
            "items": [
                ["id": "dg-1", "title": "Digest item one", "titleZh": "早报第一条", "overviewZh": "早报第一条概述。", "source": "hn"],
                ["id": "dg-2", "title": "Digest item two", "titleZh": "早报第二条", "overviewZh": "早报第二条概述。", "source": "36kr"],
            ],
            "tech": [["id": "dg-1", "title": "Digest item one", "titleZh": "早报第一条", "overviewZh": "早报第一条概述。", "source": "hn"]],
            "business": [],
            "public": [],
        ]
    }

    static func beijingToday() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Shanghai")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    // MARK: Routing

    private struct ReaderCatalogFixture: Encodable { var sources: [ReaderSource] }

    private func respond(to request: URLRequest) {
        let url = request.url ?? URL(string: "https://invalid")!
        let path = url.path
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let q = (query.first { $0.name == "q" }?.value ?? "").lowercased()
        let method = request.httpMethod ?? "GET"
        let state = FixturesURLProtocol.serverState
        state.requests.append((method, path))

        // Auth
        if path == "/api/v1/auth/request-code", method == "POST" {
            return send(status: 200, json: ["ok": true, "retryAfterSec": 60, "delivery": "sent", "apiVersion": "v1"])
        }
        if ["/api/v1/auth/verify", "/api/v1/auth/login", "/api/v1/auth/password-reset"].contains(path), method == "POST" {
            let body = decodeBody(request)
            let code = body?["code"] as? String ?? ""
            let email = (body?["email"] as? String ?? "tester@example.com").lowercased()
            guard path.hasSuffix("/login") ? (body?["password"] as? String == "Reader-test-2026!") : code == "000000" else {
                return send(status: 401, json: ["error": "invalid-code", "apiVersion": "v1"])
            }
            state.token = "fixture-token"
            state.email = email
            return send(status: 200, json: ["ok": true, "token": "fixture-token", "user": ["id": "u1", "email": email], "apiVersion": "v1"])
        }
        let authorized = request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-token"

        if path == "/api/v1/reader/catalog" {
            let data = try! JSONEncoder().encode(ReaderCatalogFixture(sources: ReaderSource.basics))
            return send(status: 200, json: try! JSONSerialization.jsonObject(with: data) as! [String: Any])
        }
        if path == "/api/v1/reader/settings" {
            if method == "PUT" {
                guard authorized else { return send(status: 401, json: ["error": "unauthorized"]) }
                if let sources = decodeBody(request)?["selectedSources"] as? [String] { state.reader.selectedSources = sources; state.reader.configured = true }
            }
            let settings = authorized ? state.reader : ReaderSettings()
            let data = try! JSONEncoder().encode(settings)
            return send(status: 200, json: ["reader": try! JSONSerialization.jsonObject(with: data)])
        }

        if path == "/api/v1/me", method == "GET" {
            guard authorized, let email = state.email else {
                return send(status: 401, json: ["error": "unauthorized", "apiVersion": "v1"])
            }
            return send(status: 200, json: ["user": ["id": "u1", "email": email], "guest": false, "apiVersion": "v1"])
        }
        if path == "/api/v1/me", method == "DELETE" {
            guard authorized else { return send(status: 401, json: ["error": "unauthorized", "apiVersion": "v1"]) }
            state.favorites = [:]
            state.deleted = []
            state.reads = [:]
            state.token = nil
            state.email = nil
            return send(status: 200, json: ["ok": true, "apiVersion": "v1"])
        }
        if path == "/api/v1/auth/logout", method == "POST" {
            state.token = nil
            state.email = nil
            return send(status: 200, json: ["ok": true, "apiVersion": "v1"])
        }

        // Reads
        if path == "/api/v1/reads", method == "POST" {
            guard authorized else { return send(status: 401, json: ["error": "unauthorized", "apiVersion": "v1"]) }
            let body = decodeBody(request)
            if let id = body?["eventId"] as? String { state.reads[id] = "2026-09-26T00:00:00.000Z" }
            return send(status: 200, json: ["ok": true, "reads": state.reads, "apiVersion": "v1"])
        }

        // Favorites
        if path == "/api/v1/favorites", method == "GET" {
            guard authorized else { return send(status: 401, json: ["error": "unauthorized", "apiVersion": "v1"]) }
            let items = state.favorites.values.map { snapshotDict($0) }
            return send(status: 200, json: ["items": items, "apiVersion": "v1"])
        }
        if path == "/api/v1/favorites", method == "POST" {
            guard authorized else { return send(status: 401, json: ["error": "unauthorized", "apiVersion": "v1"]) }
            let body = decodeBody(request)
            guard let id = body?["eventId"] as? String else { return send(status: 404, json: ["error": "not found", "apiVersion": "v1"]) }
            state.deleted.remove(id)   // explicit POST resurrects (server semantics)
            if let snap = body?["snapshot"] as? [String: Any] {
                state.favorites[id] = EventItem.dictToItem(snap) ?? EventItem(id: id, title: id)
            }
            return send(status: 200, json: ["ok": true, "rev": 1, "apiVersion": "v1"])
        }
        if path.hasPrefix("/api/v1/favorites/"), method == "DELETE" {
            guard authorized else { return send(status: 401, json: ["error": "unauthorized", "apiVersion": "v1"]) }
            let id = String(path.dropFirst("/api/v1/favorites/".count)).removingPercentEncoding ?? ""
            state.favorites.removeValue(forKey: id)
            state.deleted.insert(id)
            return send(status: 200, json: ["ok": true, "rev": 2, "apiVersion": "v1"])
        }

        // Sync merge — mirrors the server: deletes win, merge never resurrects.
        if path == "/api/v1/sync/merge", method == "POST" {
            guard authorized else { return send(status: 401, json: ["error": "unauthorized", "apiVersion": "v1"]) }
            let body = decodeBody(request) ?? [:]
            if let reads = body["reads"] as? [String: String] {
                for (k, v) in reads where state.reads[k] == nil && !v.isEmpty { state.reads[k] = v }
            }
            if let favorites = body["favorites"] as? [[String: Any]] {
                for it in favorites {
                    guard let id = (it["id"] as? String) ?? (it["eventId"] as? String) else { continue }
                    let isDeleted = it["deleted"] as? Bool ?? false
                    let existing = state.favorites[id]
                    if isDeleted {
                        state.favorites.removeValue(forKey: id)
                        state.deleted.insert(id)
                    } else if state.deleted.contains(id) {
                        // do-not-resurrect
                    } else if existing == nil {
                        if let snap = it["snapshot"] as? [String: Any] {
                            state.favorites[id] = EventItem.dictToItem(snap) ?? EventItem(id: id, title: id)
                        }
                    }
                }
            }
            let rows: [[String: Any]] = state.favorites.values.map { ["eventId": $0.id, "snapshot": snapshotDict($0), "rev": 1] }
            return send(status: 200, json: ["ok": true, "favorites": rows, "reads": state.reads, "apiVersion": "v1"])
        }

        // Digest
        if path == "/api/v1/digest", method == "GET" {
            return send(status: 200, json: ["digest": Self.digestFixture(), "apiVersion": "v1"])
        }

        // Events list + detail
        if path == "/api/v1/events", method == "GET" {
            if Self.forceErrorOnce && !Self.errorConsumed && query.first(where: { $0.name == "view" })?.value == "reader" {
                Self.errorConsumed = true
                return send(status: 502, json: ["error": "bad gateway", "apiVersion": "v1"])
            }
            let view = query.first { $0.name == "view" }?.value ?? "featured"
            var items: [[String: Any]]
            switch view {
            case "reader":
                let selected = authorized ? state.reader.selectedSources : (query.first { $0.name == "sources" }?.value ?? "").split(separator: ",").map(String.init)
                items = (Self.fixtureItems() + Self.repoItems()).filter { selected.contains($0["source"] as? String ?? "") }
            case "opensource": items = Self.repoItems()
            case "latest": items = Array(Self.fixtureItems().reversed())
            default: items = Self.fixtureItems()
            }
            if !q.isEmpty {
                items = items.filter {
                    let blob = (($0["title"] as? String ?? "") + ($0["titleZh"] as? String ?? "") + ($0["overviewZh"] as? String ?? "") + ($0["summary"] as? String ?? "") + ($0["summaryZh"] as? String ?? "")).lowercased()
                    return blob.contains(q)
                }
            }
            let cursor = query.first { $0.name == "cursor" }?.value
            let start = cursor.flatMap { Int(base64UrlDecode($0) ?? "") } ?? 0
            let limit = Int(query.first { $0.name == "limit" }?.value ?? "30") ?? 30
            let slice = Array(items.dropFirst(start).prefix(limit))
            let next = start + slice.count < items.count ? base64UrlEncode(String(start + slice.count)) : nil
            var envelope: [String: Any] = ["items": slice, "view": view, "total": items.count, "snapshotAt": "2026-09-26T00:00:00.000Z", "apiVersion": "v1"]
            if view == "reader" { envelope["reader"] = true }
            if let next { envelope["cursor"] = next }
            return send(status: 200, json: envelope)
        }

        if path.hasPrefix("/api/v1/events/"), method == "GET" {
            let id = String(path.dropFirst("/api/v1/events/".count)).removingPercentEncoding ?? ""
            if let all = Self.fixtureItems().first(where: { $0["id"] as? String == id })
                ?? Self.repoItems().first(where: { $0["id"] as? String == id }) {
                return send(status: 200, json: ["item": all, "members": [], "apiVersion": "v1"])
            }
            if let saved = state.favorites[id] {
                return send(status: 200, json: ["item": snapshotDict(saved), "fromFavorite": true, "apiVersion": "v1"])
            }
            return send(status: 404, json: ["error": "not found", "apiVersion": "v1"])
        }

        send(status: 404, json: ["error": "not found", "apiVersion": "v1"])
    }

    private func snapshotDict(_ item: EventItem) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(item),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return ["id": item.id, "title": item.title] }
        return dict
    }

    private func decodeBody(_ request: URLRequest) -> [String: Any]? {
        let body: Data?
        if let b = request.httpBody {
            body = b
        } else if let stream = request.httpBodyStream {
            body = FixturesURLProtocol.readStream(stream)
        } else {
            body = nil
        }
        guard let body else { return nil }
        return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
    }

    private static func readStream(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufSize = 4096
        let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: bufSize)
        defer { buf.deallocate() }
        while stream.hasBytesAvailable {
            let read = stream.read(buf, maxLength: bufSize)
            if read <= 0 { break }
            data.append(buf, count: read)
        }
        return data
    }

    private func send(status: Int, json: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: json) else { return }
        let response = HTTPURLResponse(url: request.url ?? URL(string: "https://quack.weichao.ren")!,
                                       statusCode: status,
                                       httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    private func base64UrlEncode(_ s: String) -> String {
        Data(s.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func base64UrlDecode(_ s: String) -> String? {
        var pad = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while pad.count % 4 != 0 { pad += "=" }
        guard let data = Data(base64Encoded: pad) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

extension EventItem {
    static func dictToItem(_ dict: [String: Any]) -> EventItem? {
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return nil }
        return try? JSONDecoder().decode(EventItem.self, from: data)
    }
}
#endif
