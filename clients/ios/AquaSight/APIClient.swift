import Foundation

protocol TokenStore: AnyObject {
    func save(_ token: String)
    func read() -> String?
    func clear()
}

/// Typed HTTP client for the canonical AquaSight API (https://quack.weichao.ren).
///
/// - Cookie-free by construction: the web session cookie (`aqs_session`) must
///   never be retained on this client, otherwise a logged-out device could
///   keep sending the previous account's identity.
/// - Query strings are built with URLComponents (safe percent-encoding).
/// - Path components are pre-encoded and injected via `percentEncodedPath`
///   so IDs like `evt:a/b?x#%` are escaped exactly once.
struct APIClient {
    let base: URL
    let tokenStore: TokenStore
    private let session: URLSession

    init(base: URL, tokenStore: TokenStore, session: URLSession? = nil) {
        self.base = base
        self.tokenStore = tokenStore
        if let session {
            self.session = session
        } else {
            self.session = Self.makeDefaultSession()
        }
    }

    static func makeDefaultSession() -> URLSession {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 20
        cfg.timeoutIntervalForResource = 45
        cfg.httpShouldSetCookies = false
        cfg.httpCookieAcceptPolicy = .never
        cfg.httpCookieStorage = nil
        cfg.waitsForConnectivity = false
        return URLSession(configuration: cfg)
    }

    func authenticated(token: String?) -> APIClient {
        APIClient(base: base, tokenStore: SnapshotTokenStore(token), session: session)
    }

    // MARK: Endpoints

    func events(view: String, q: String = "", cursor: String? = nil, limit: Int = 30) async throws -> EventsResponse {
        var query: [URLQueryItem] = [URLQueryItem(name: "view", value: view), URLQueryItem(name: "limit", value: String(limit))]
        if !q.isEmpty { query.append(URLQueryItem(name: "q", value: q)) }
        if let cursor, !cursor.isEmpty { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await get(path: "/api/v1/events", query: query, auth: false)
    }

    func event(id: String) async throws -> EventDetailResponse {
        try await get(path: "/api/v1/events/\(Self.encodePathSegment(id))", query: [], auth: true)
    }

    func readerCatalog() async throws -> ReaderCatalogResponse {
        try await get(path: "/api/v1/reader/catalog", query: [], auth: true)
    }
    func readerSettings() async throws -> ReaderSettingsResponse {
        try await get(path: "/api/v1/reader/settings", query: [], auth: true)
    }
    func saveReaderSources(_ sources: [String]) async throws -> ReaderSettingsResponse {
        struct Body: Encodable { var selectedSources: [String] }
        return try await call(method: "PUT", path: "/api/v1/reader/settings", query: [], body: Body(selectedSources: sources), auth: true)
    }
    func readerEvents(sources: [String], q: String, cursor: String?) async throws -> EventsResponse {
        var query = [URLQueryItem(name: "view", value: "reader"), URLQueryItem(name: "sources", value: sources.joined(separator: ",")), URLQueryItem(name: "q", value: q)]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        let result: EventsResponse = try await get(path: "/api/v1/events", query: query, auth: true)
        guard result.reader == true else { throw APIError.readerUnavailable }
        return result
    }
    func readerEvent(id: String, sources: [String]) async throws -> EventDetailResponse {
        try await get(path: "/api/v1/events/\(Self.encodePathSegment(id))", query: [URLQueryItem(name: "reader", value: "1"), URLQueryItem(name: "sources", value: sources.joined(separator: ","))], auth: true)
    }

    func digest() async throws -> DigestResponse {
        try await get(path: "/api/v1/digest", query: [], auth: false)
    }

    func me() async throws -> MeResponse {
        try await get(path: "/api/v1/me", query: [], auth: true)
    }

    func requestCode(email: String) async throws -> OkEnvelope {
        struct Body: Codable { var email: String }
        return try await post(path: "/api/v1/auth/request-code", body: Body(email: email), auth: false)
    }

    func verify(email: String, code: String) async throws -> VerifyResponse {
        struct Body: Codable { var email: String; var code: String }
        let resp: VerifyResponse = try await post(path: "/api/v1/auth/verify", body: Body(email: email, code: code), auth: false)
        // The session owner persists the token only after validating its login generation.
        return resp
    }

    func login(email: String, password: String) async throws -> VerifyResponse {
        struct Body: Codable { var email: String; var password: String }
        return try await post(path: "/api/v1/auth/login", body: Body(email: email, password: password), auth: false)
    }
    func resetPassword(email: String, code: String, password: String) async throws -> VerifyResponse {
        struct Body: Codable { var email: String; var code: String; var password: String }
        return try await post(path: "/api/v1/auth/password-reset", body: Body(email: email, code: code, password: password), auth: false)
    }

    func logout() async {
        struct Body: Codable {}
        _ = try? await post(path: "/api/v1/auth/logout", body: Body(), auth: true) as OkEnvelope

    }

    func favorites() async throws -> [EventItem] {
        let resp: FavoritesResponse = try await get(path: "/api/v1/favorites", query: [], auth: true)
        guard let items = resp.items else { throw APIError.invalidResponse }
        return items
    }

    func addFavorite(_ item: EventItem) async throws {
        struct Body: Codable { var eventId: String; var snapshot: EventItem }
        let _: OkEnvelope = try await post(path: "/api/v1/favorites", body: Body(eventId: item.id, snapshot: item), auth: true)
    }

    func deleteFavorite(id: String) async throws {
        let _: OkEnvelope = try await call(method: "DELETE", path: "/api/v1/favorites/\(Self.encodePathSegment(id))", query: [], body: Optional<OkEnvelope>.none, auth: true)
    }

    /// Explicit re-save of a server tombstone: POST /favorites resurrects, the
    /// merge endpoint never does. Used after reconciliation.
    func merge(_ body: MergeRequestBody) async throws -> MergeResponse {
        try await post(path: "/api/v1/sync/merge", body: body, auth: true)
    }

    func markRead(eventId: String) async throws {
        struct Body: Codable { var eventId: String }
        let _: OkEnvelope = try await post(path: "/api/v1/reads", body: Body(eventId: eventId), auth: true)
    }

    /// DELETE /api/v1/me — full account data removal. Only invoked from the
    /// explicit destructive in-app flow after user confirmation.
    func deleteAccount() async throws {
        let _: OkEnvelope = try await call(method: "DELETE", path: "/api/v1/me", query: [], body: Optional<OkEnvelope>.none, auth: true)
    }

    // MARK: URL construction

    static func encodePathSegment(_ raw: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return raw.addingPercentEncoding(withAllowedCharacters: allowed) ?? raw
    }

    static func buildURL(base: URL, encodedPath: String, query: [URLQueryItem]) -> URL? {
        var comps = URLComponents()
        comps.scheme = base.scheme
        comps.host = base.host
        comps.port = base.port
        // Path arrives pre-encoded; assigning percentEncodedPath never double-escapes.
        comps.percentEncodedPath = encodedPath
        if !query.isEmpty { comps.percentEncodedQuery = Self.encodeQuery(query) }
        return comps.url
    }

    private static func encodeQuery(_ items: [URLQueryItem]) -> String {
        var comps = URLComponents()
        comps.queryItems = items
        return (comps.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
    }

    // MARK: Transport

    private func get<T: Decodable>(path: String, query: [URLQueryItem], auth: Bool) async throws -> T {
        try await call(method: "GET", path: path, query: query, body: Optional<OkEnvelope>.none, auth: auth)
    }

    private func post<B: Encodable, T: Decodable>(path: String, body: B, auth: Bool) async throws -> T {
        try await call(method: "POST", path: path, query: [], body: body, auth: auth)
    }

    struct APIErrorResponse: Decodable {
        var error: String?
    }

    private func call<B: Encodable, T: Decodable>(method: String, path: String, query: [URLQueryItem], body: B?, auth: Bool) async throws -> T {
        let url = Self.buildURL(base: base, encodedPath: path, query: query)
        guard let url else { throw APIError.invalidResponse }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpShouldHandleCookies = false
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("AquaSight-iOS/0.3", forHTTPHeaderField: "User-Agent")
        if auth, let token = tokenStore.read(), !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.httpBody = try JSONEncoder().encode(body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let resp: URLResponse
        do {
            (data, resp) = try await session.data(for: req)
        } catch let e as URLError where e.code == .timedOut {
            throw APIError.network("timeout")
        } catch is CancellationError {
            throw APIError.network("cancelled")
        } catch {
            throw APIError.network(error.localizedDescription)
        }
        guard let http = resp as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let code = (try? JSONDecoder().decode(APIErrorResponse.self, from: data))?.error
            throw APIError.status(http.statusCode, code: code)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }
}

private final class SnapshotTokenStore: TokenStore {
    private let token: String?
    init(_ token: String?) { self.token = token }
    func read() -> String? { token }
    func save(_ token: String) {}
    func clear() {}
}
