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

    func events(view: String) async throws -> [String: Any] {
        try await get(path: "/api/v1/events?view=\(view)")
    }

    func merge(reads: [String: String], favorites: [[String: Any]], prefs: [String: Any]) async throws -> [String: Any] {
        try await post(path: "/api/v1/sync/merge", body: [
            "reads": reads,
            "favorites": favorites,
            "prefs": prefs
        ])
    }

    func logout() async throws {
        _ = try await post(path: "/api/v1/auth/logout", body: [:])
        tokenStore.clear()
    }

    private func get(path: String) async throws -> [String: Any] {
        try await call(method: "GET", path: path, body: nil, auth: true)
    }

    private func post(path: String, body: [String: Any], auth: Bool = true) async throws -> [String: Any] {
        try await call(method: "POST", path: path, body: body, auth: auth)
    }

    private func call(method: String, path: String, body: [String: Any]?, auth: Bool) async throws -> [String: Any] {
        var req = URLRequest(url: base.appendingPathComponent(path).absoluteURL)
        // appendingPathComponent breaks query; use string concat for query paths
        req = URLRequest(url: URL(string: base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path)!)
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

protocol TokenStore {
    func save(_ token: String)
    func read() -> String?
    func clear()
}

final class KeychainStore: TokenStore {
    private let key = "aquasight.session"
    func save(_ token: String) { UserDefaults.standard.set(token, forKey: key) /* replace with Keychain in release */ }
    func read() -> String? { UserDefaults.standard.string(forKey: key) }
    func clear() { UserDefaults.standard.removeObject(forKey: key) }
}
