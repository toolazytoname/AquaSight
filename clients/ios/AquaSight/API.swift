import Foundation

struct AquaSightAPI {
    let base: URL
    let tokenStore: TokenStore

    func requestCode(email: String) async throws -> [String: Any] {
        try await post(path: "/api/v1/auth/request-code", body: ["email": email], auth: false)
    }

    func verify(email: String, code: String) async throws -> [String: Any] {
        let data = try await post(path: "/api/v1/auth/verify", body: ["email": email, "code": code], auth: false)
        if let token = data["token"] as? String { tokenStore.save(token) }
        return data
    }

    func events(view: String, q: String = "") async throws -> [String: Any] {
        var path = "/api/v1/events?view=\(view)"
        if !q.isEmpty, let encoded = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "&q=\(encoded)"
        }
        return try await get(path: path)
    }

    func event(id: String) async throws -> [String: Any] {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await get(path: "/api/v1/events/\(encoded)")
    }

    func digest() async throws -> [String: Any] {
        try await get(path: "/api/v1/digest")
    }

    func saveFavorite(id: String, snapshot: [String: Any]) async throws {
        _ = try await post(path: "/api/v1/favorites", body: ["eventId": id, "snapshot": snapshot])
    }

    func deleteFavorite(id: String) async throws {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        _ = try await call(method: "DELETE", path: "/api/v1/favorites/\(encoded)", body: nil, auth: true)
    }

    func merge(_ body: [String: Any]) async throws -> [String: Any] {
        try await post(path: "/api/v1/sync/merge", body: body)
    }

    func logout() async {
        _ = try? await post(path: "/api/v1/auth/logout", body: [:])
        tokenStore.clear()
    }

    private func get(path: String) async throws -> [String: Any] {
        try await call(method: "GET", path: path, body: nil, auth: true)
    }

    private func post(path: String, body: [String: Any], auth: Bool = true) async throws -> [String: Any] {
        try await call(method: "POST", path: path, body: body, auth: auth)
    }

    private func call(method: String, path: String, body: [String: Any]?, auth: Bool) async throws -> [String: Any] {
        let root = base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: root + path) else { throw APIError.status(400, [:]) }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if auth, let token = tokenStore.read(), !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let http = resp as! HTTPURLResponse
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if http.statusCode >= 400 { throw APIError.status(http.statusCode, obj) }
        return obj
    }
}

enum APIError: Error { case status(Int, [String: Any]) }

func displayTitle(_ item: [String: Any]) -> String {
    let zh = item["titleZh"] as? String ?? ""
    if !zh.isEmpty { return zh }
    return item["title"] as? String ?? ""
}

func overviewText(_ item: [String: Any]) -> String {
    let zh = item["overviewZh"] as? String ?? ""
    if !zh.isEmpty { return zh }
    return item["summary"] as? String ?? ""
}
