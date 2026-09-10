import Foundation

struct GuestStore {
    private let key = "aquasight.guest"
    private let defaults = UserDefaults.standard

    private func load() -> [String: Any] {
        defaults.dictionary(forKey: key) ?? ["items": [:], "deleted": [:], "reads": [:], "prefs": [:]]
    }

    private func save(_ data: [String: Any]) {
        defaults.set(data, forKey: key)
    }

    func items() -> [[String: Any]] {
        let map = load()["items"] as? [String: [String: Any]] ?? [:]
        return Array(map.values)
    }

    func item(id: String) -> [String: Any]? {
        (load()["items"] as? [String: [String: Any]])?[id]
    }

    func deletedIds() -> [String] {
        Array((load()["deleted"] as? [String: Any] ?? [:]).keys)
    }

    func isSaved(_ id: String) -> Bool {
        item(id: id) != nil
    }

    func save(id: String, snapshot: [String: Any]) {
        var data = load()
        var items = data["items"] as? [String: [String: Any]] ?? [:]
        var deleted = data["deleted"] as? [String: Any] ?? [:]
        items[id] = snapshot
        deleted.removeValue(forKey: id)
        data["items"] = items
        data["deleted"] = deleted
        save(data)
    }

    func remove(id: String) {
        var data = load()
        var items = data["items"] as? [String: [String: Any]] ?? [:]
        var deleted = data["deleted"] as? [String: Any] ?? [:]
        items.removeValue(forKey: id)
        deleted[id] = true
        data["items"] = items
        data["deleted"] = deleted
        save(data)
    }

    func markRead(_ id: String) {
        var data = load()
        var reads = data["reads"] as? [String: String] ?? [:]
        if reads[id] == nil {
            reads[id] = ISO8601DateFormatter().string(from: Date())
            data["reads"] = reads
            save(data)
        }
    }

    func mergeBody() -> [String: Any] {
        var favorites: [[String: Any]] = []
        var seen = Set<String>()
        for id in deletedIds() {
            seen.insert(id)
            favorites.append(["id": id, "deleted": true])
        }
        for it in items() {
            guard let id = it["id"] as? String, seen.insert(id).inserted else { continue }
            favorites.append(["id": id, "snapshot": it])
        }
        let data = load()
        return [
            "reads": data["reads"] ?? [:],
            "prefs": data["prefs"] ?? [:],
            "favorites": favorites
        ]
    }
}
