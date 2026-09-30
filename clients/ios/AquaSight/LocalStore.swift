import Foundation
import CryptoKit

struct PendingOp: Codable, Equatable {
    enum Kind: String, Codable { case save, delete }
    var id: String
    var kind: Kind
    var snapshot: EventItem?
    var queuedAt: String
    var operationID = UUID().uuidString
    enum CodingKeys: String, CodingKey { case id, kind, snapshot, queuedAt, operationID }
    init(id: String, kind: Kind, snapshot: EventItem?, queuedAt: String) {
        self.id = id; self.kind = kind; self.snapshot = snapshot; self.queuedAt = queuedAt
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(Kind.self, forKey: .kind)
        snapshot = try c.decodeIfPresent(EventItem.self, forKey: .snapshot)
        queuedAt = try c.decodeIfPresent(String.self, forKey: .queuedAt) ?? ""
        operationID = try c.decodeIfPresent(String.self, forKey: .operationID) ?? UUID().uuidString
    }
}

struct LocalStoreRecord: Codable {
    var favorites: [String: EventItem] = [:]
    var tombstones: [String: String] = [:]
    var reads: [String: String] = [:]
    var pendingReads: [String: String] = [:]
    var pendingOps: [PendingOp] = []
    var mergeOwnerEmail: String?
    var savedAt: [String: Date] = [:]
    enum CodingKeys: String, CodingKey { case favorites, tombstones, reads, pendingReads, pendingOps, mergeOwnerEmail, savedAt }
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        favorites = try c.decodeIfPresent([String: EventItem].self, forKey: .favorites) ?? [:]
        tombstones = try c.decodeIfPresent([String: String].self, forKey: .tombstones) ?? [:]
        reads = try c.decodeIfPresent([String: String].self, forKey: .reads) ?? [:]
        pendingReads = try c.decodeIfPresent([String: String].self, forKey: .pendingReads) ?? reads
        pendingOps = try c.decodeIfPresent([PendingOp].self, forKey: .pendingOps) ?? []
        mergeOwnerEmail = try c.decodeIfPresent(String.self, forKey: .mergeOwnerEmail)
        savedAt = try c.decodeIfPresent([String: Date].self, forKey: .savedAt) ?? [:]
    }
}

final class LocalStore {
    let accountKey: String
    private let fileURL: URL
    private(set) var record: LocalStoreRecord
    private(set) var lastPersistenceError: String?
    static func accountKey(for email: String?) -> String {
        guard let email = email?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !email.isEmpty else { return "guest" }
        return "u-" + SHA256.hash(data: Data(email.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
    }
    init(accountKey: String, directory: URL? = nil) {
        self.accountKey = accountKey
        let dir = directory ?? Self.defaultDirectory()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent(accountKey + ".json")
        if let data = try? Data(contentsOf: fileURL), let decoded = try? JSONDecoder().decode(LocalStoreRecord.self, from: data) {
            record = decoded
        } else {
            record = LocalStoreRecord()
            if directory == nil, accountKey == "guest", !FileManager.default.fileExists(atPath: fileURL.path) { migrateLegacyGuest() }
        }
    }
    static func defaultDirectory() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("AquaSight/accounts", isDirectory: true)
    }
    static func removeAllAccounts(directory: URL? = nil) {
        let dir = directory ?? defaultDirectory()
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    private func persist() {
        do {
            let data = try JSONEncoder().encode(record)
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            lastPersistenceError = nil
        } catch { lastPersistenceError = error.localizedDescription }
    }
    private func migrateLegacyGuest() {
        guard let old = UserDefaults.standard.dictionary(forKey: "aquasight.guest") else { return }
        for (id, value) in old["items"] as? [String: [String: Any]] ?? [:] {
            guard let data = try? JSONSerialization.data(withJSONObject: value), let item = try? JSONDecoder().decode(EventItem.self, from: data) else { continue }
            record.favorites[id] = item
        }
        for id in (old["deleted"] as? [String: Any] ?? [:]).keys {
            record.favorites.removeValue(forKey: id)
            record.tombstones[id] = ISO8601DateFormatter().string(from: Date())
        }
        record.reads = old["reads"] as? [String: String] ?? [:]
        persist() // Keep the old source intact; an existing new file prevents repeat imports.
    }
    var savedItems: [EventItem] {
        record.favorites.values.sorted {
            let a = record.savedAt[$0.id] ?? .distantPast, b = record.savedAt[$1.id] ?? .distantPast
            return a == b ? $0.id < $1.id : a > b
        }
    }
    func isSaved(_ id: String) -> Bool { record.favorites[id] != nil }
    func item(id: String) -> EventItem? { record.favorites[id] }
    func save(_ item: EventItem, enqueue: Bool = false) {
        record.favorites[item.id] = item
        record.savedAt[item.id] = Date()
        record.tombstones.removeValue(forKey: item.id)
        if enqueue { self.enqueue(id: item.id, kind: .save, snapshot: item) }
        persist()
    }
    func remove(id: String, enqueue: Bool = false) {
        record.favorites.removeValue(forKey: id)
        record.savedAt.removeValue(forKey: id)
        record.tombstones[id] = ISO8601DateFormatter().string(from: Date())
        if enqueue { self.enqueue(id: id, kind: .delete, snapshot: nil) }
        persist()
    }
    var tombstoneIds: [String] { Array(record.tombstones.keys) }
    func hasTombstone(_ id: String) -> Bool { record.tombstones[id] != nil }
    func isRead(_ id: String) -> Bool { record.reads[id] != nil }
    func markRead(_ id: String) {
        guard !isRead(id) else { return }
        let at = ISO8601DateFormatter().string(from: Date())
        record.reads[id] = at; record.pendingReads[id] = at; persist()
    }
    private func enqueue(id: String, kind: PendingOp.Kind, snapshot: EventItem?) {
        record.pendingOps.removeAll { $0.id == id }
        record.pendingOps.append(PendingOp(id: id, kind: kind, snapshot: snapshot, queuedAt: ISO8601DateFormatter().string(from: Date())))
    }
    func enqueueSave(_ item: EventItem) { enqueue(id: item.id, kind: .save, snapshot: item); persist() }
    func enqueueDelete(id: String) { enqueue(id: id, kind: .delete, snapshot: nil); persist() }
    var pendingOps: [PendingOp] { record.pendingOps }
    var hasPendingOps: Bool { !record.pendingOps.isEmpty }
    func acknowledge(_ operation: PendingOp) {
        record.pendingOps.removeAll { $0.operationID == operation.operationID }
        if operation.kind == .delete, !record.pendingOps.contains(where: { $0.id == operation.id }) { record.tombstones.removeValue(forKey: operation.id) }
        persist()
    }
    func mergeRequestBody() -> MergeRequestBody {
        MergeRequestBody(reads: record.reads, favorites: tombstoneIds.map { MergeFavorite(id: $0, deleted: true, snapshot: nil) } + savedItems.map { MergeFavorite(id: $0.id, deleted: nil, snapshot: $0) })
    }
    var mergeOwnerEmail: String? { record.mergeOwnerEmail }
    func claimMergeOwner(_ email: String) {
        guard record.mergeOwnerEmail == nil else { return }
        record.mergeOwnerEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(); persist()
    }
    var isEmptyForTransfer: Bool { record.favorites.isEmpty && record.tombstones.isEmpty && record.reads.isEmpty }
    func wipe() { record = LocalStoreRecord(); persist() }
    func adoptServerReads(_ reads: [String: String], acknowledging sent: [String: String] = [:]) {
        for (id, at) in sent where record.pendingReads[id] == at { record.pendingReads.removeValue(forKey: id) }
        // Server is authoritative for acknowledged markers, including a Web
        // action that marks an item unread. Only unsent local reads overlay it.
        record.reads = reads.merging(record.pendingReads) { _, local in local }
        persist()
    }
    func adoptServerFavorites(_ items: [EventItem]) {
        var server: [String: EventItem] = [:]
        for item in items where !hasTombstone(item.id) { server[item.id] = item }
        for operation in record.pendingOps {
            if operation.kind == .save, let snapshot = operation.snapshot { server[operation.id] = snapshot }
            if operation.kind == .delete { server.removeValue(forKey: operation.id) }
        }
        record.favorites = server
        record.savedAt = record.savedAt.filter { server[$0.key] != nil }
        persist()
    }
}

enum AccountIdentityStore {
    private static func fileURL(_ directory: URL?) -> URL { (directory ?? LocalStore.defaultDirectory()).appendingPathComponent("active-account.json") }
    static func save(email: String?, directory: URL? = nil) {
        let url = fileURL(directory)
        if let email, let data = try? JSONEncoder().encode(["email": email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()]) {
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } else { try? FileManager.default.removeItem(at: url) }
    }
    static func read(directory: URL? = nil) -> String? {
        guard let data = try? Data(contentsOf: fileURL(directory)), let value = try? JSONDecoder().decode([String: String].self, from: data) else { return nil }
        return value["email"]
    }
    static func clear(directory: URL? = nil) { save(email: nil, directory: directory) }
}
