import Foundation
import SwiftUI

enum AuthState: Equatable { case unknown, guest, loggedIn(email: String) }
enum Tab: String, CaseIterable, Identifiable {
    case reading, subscriptions, saved, featured, latest, opensource, digest
    var id: String { rawValue }
    var title: String {
        switch self { case .reading: return "阅读"; case .subscriptions: return "订阅"; case .featured: return "精选"; case .latest: return "最新"; case .opensource: return "开源"; case .digest: return "早报"; case .saved: return "收藏" }
    }
    var systemImage: String {
        switch self { case .reading: return "text.book.closed"; case .subscriptions: return "square.stack.3d.up"; case .featured: return "sparkles"; case .latest: return "clock"; case .opensource: return "curlybraces.square"; case .digest: return "newspaper"; case .saved: return "bookmark.fill" }
    }
}

@MainActor
final class AppModel: ObservableObject {
    let reader: ReaderModel
    let api: APIClient
    let keychain: TokenStore
    let storeDirectory: URL?
    @Published var auth: AuthState = .unknown
    @Published var selectedTab: Tab = .reading
    @Published var savedItems: [EventItem] = []
    @Published var savedIds: Set<String> = []
    @Published var notice: String?
    @Published var showLogin = false
    @Published var deepLinkEventId: String?
    @Published var resendCooldown = 0
    @Published var syncState: SyncState = .idle
    @Published var lastSyncedAt: Date?
    enum SyncState: Equatable { case idle, syncing, failed(String) }
    enum SyncOutcome: Equatable { case ok, syncFailed }

    private(set) var store: LocalStore
    private var generation = 0
    private var hasRestored = false
    private var syncTask: Task<SyncOutcome, Never>?
    private var cooldownTimer: Timer?
    private var resendAvailableAt: Date?

    init(api: APIClient, keychain: TokenStore, storeDirectory: URL? = nil) {
        self.reader = ReaderModel(api: api, directory: storeDirectory)
        self.api = api
        self.keychain = keychain
        self.storeDirectory = storeDirectory
        store = LocalStore(accountKey: "guest", directory: storeDirectory)
        publishStore()
    }

    var currentEmail: String? { if case .loggedIn(let email) = auth { return email }; return nil }
    var canMutateServer: Bool { currentEmail != nil && api.tokenStore.read() != nil }
    private func normalized(_ email: String) -> String { email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    private var guestStore: LocalStore { LocalStore(accountKey: "guest", directory: storeDirectory) }
    private func publishStore() { savedItems = store.savedItems; savedIds = Set(savedItems.map(\.id)) }

    private func switchAccount(email: String?) {
        generation += 1
        syncTask?.cancel()
        syncTask = nil
        syncState = .idle
        lastSyncedAt = nil
        store = LocalStore(accountKey: LocalStore.accountKey(for: email), directory: storeDirectory)
        reader.activate(email: email, token: api.tokenStore.read())
        deepLinkEventId = nil
        auth = email.map { .loggedIn(email: normalized($0)) } ?? .guest
        AccountIdentityStore.save(email: email, directory: storeDirectory)
        publishStore()
    }

    func restoreSession() async {
        guard !hasRestored else { return }
        hasRestored = true
        guard let token = api.tokenStore.read(), !token.isEmpty else { switchAccount(email: nil); return }
        if let email = AccountIdentityStore.read(directory: storeDirectory) { switchAccount(email: email) }
        let gen = generation
        let client = api.authenticated(token: token)
        do {
            let me = try await client.me()
            guard gen == generation else { return }
            guard let email = me.user?.email, !email.isEmpty, me.guest != true else { sessionExpired(); return }
            if currentEmail != normalized(email) { switchAccount(email: email) }
            await reader.refresh()
            await syncNow(showNotice: false)
        } catch let error as APIError where error.isUnauthorized {
            guard gen == generation else { return }
            sessionExpired()
        } catch {
            guard gen == generation else { return }
            // Never discard a valid credential simply because the network is unavailable.
            if currentEmail == nil { auth = .unknown }
            notice = "暂时无法连接，已保留本机内容和登录凭据。"
        }
    }

    func isSaved(_ id: String) -> Bool { savedIds.contains(id) }
    func isRead(_ id: String) -> Bool { store.isRead(id) }
    func toggleSave(_ item: EventItem) { isSaved(item.id) ? unsave(id: item.id) : save(item) }
    func save(_ item: EventItem) {
        store.save(item, enqueue: canMutateServer)
        publishStore()
        notice = store.lastPersistenceError == nil ? "已收藏，离线也能阅读。" : "收藏尚未写入本机，请检查设备存储空间。"
        scheduleSync()
    }
    func unsave(id: String) {
        guard isSaved(id) else { return }
        store.remove(id: id, enqueue: canMutateServer)
        publishStore()
        notice = store.lastPersistenceError == nil ? "已取消收藏。" : "取消操作尚未写入本机，请检查设备存储空间。"
        scheduleSync()
    }
    func markRead(_ id: String) {
        guard !store.isRead(id) else { return }
        store.markRead(id)
        objectWillChange.send()
        scheduleSync()
    }
    private func scheduleSync() {
        guard canMutateServer else { return }
        let gen = generation
        Task { [weak self] in
            guard let self, gen == self.generation else { return }
            await self.syncNow(showNotice: false)
        }
    }

    struct CodeRequestResult {
        let accepted: Bool
        let message: String
    }

    func requestCode(email: String) async -> CodeRequestResult {
        do {
            let response = try await api.requestCode(email: normalized(email))
            guard response.ok == true, response.delivery != "unavailable" else {
                return CodeRequestResult(accepted: false, message: "邮件服务暂时不可用，请稍后重试。")
            }
            startCooldown(response.retryAfterSec ?? 60)
            return CodeRequestResult(accepted: true, message: "请查收邮箱，验证码 10 分钟内有效。若未收到，请检查垃圾邮件。")
        } catch {
            return CodeRequestResult(accepted: false, message: (error as? APIError)?.userMessage ?? "暂时发不出验证码，请稍后重试。")
        }
    }

    func verify(email: String, code: String) async -> String? {
        await authenticate(failure: "验证码无效或已过期。") { try await self.api.verify(email: self.normalized(email), code: code) }
    }
    func login(email: String, password: String) async -> String? {
        await authenticate(failure: "邮箱或密码不正确。老账户请先设置密码。") { try await self.api.login(email: self.normalized(email), password: password) }
    }
    func resetPassword(email: String, code: String, password: String) async -> String? {
        await authenticate(failure: "验证码无效或已过期。") { try await self.api.resetPassword(email: self.normalized(email), code: code, password: password) }
    }
    private func authenticate(failure: String, request: () async throws -> VerifyResponse) async -> String? {
        generation += 1
        let gen = generation
        let priorGuest = store.accountKey == "guest" ? store : nil
        do {
            let response = try await request()
            guard gen == generation else { return "登录操作已取消。" }
            guard let token = response.token, !token.isEmpty,
                  let accountEmail = response.user?.email, !accountEmail.isEmpty else { return "登录返回信息不完整，请重试。" }
            keychain.save(token)
            guard keychain.read() == token else { return "无法安全保存登录凭据，请重试。" }
            let owner = normalized(accountEmail)
            if let guest = priorGuest, !guest.isEmptyForTransfer,
               guest.mergeOwnerEmail == nil || guest.mergeOwnerEmail == owner { guest.claimMergeOwner(owner) }
            switchAccount(email: owner)
            showLogin = false
            await reader.refresh()
            let outcome = await syncNow(showNotice: false)
            if outcome == .syncFailed, currentEmail == owner { notice = "已登录，部分收藏待同步，可在「收藏」中重试。" }
            return nil
        } catch let error as APIError where error.isUnauthorized {
            if case .status(_, let code) = error, code == "unauthorized" { return "账户服务正在更新，暂时无法登录，请稍后重试。" }
            return failure
        }
        catch { return (error as? APIError)?.userMessage ?? "登录失败，请重试。" }
    }

    var guestHasPendingTransfer: Bool {
        guard let email = currentEmail else { return false }
        let guest = guestStore
        return !guest.isEmptyForTransfer && guest.mergeOwnerEmail == email
    }

    @discardableResult
    func syncNow(guestPayload: MergeRequestBody? = nil, showNotice: Bool = true) async -> SyncOutcome {
        guard canMutateServer, let token = api.tokenStore.read(), let email = currentEmail else { return .ok }
        if let task = syncTask { return await task.value }
        let gen = generation
        let capturedStore = store
        let client = api.authenticated(token: token)
        syncState = .syncing
        let task = Task { [weak self] () -> SyncOutcome in
            guard let self else { return .syncFailed }
            return await self.performSync(client: client, store: capturedStore, email: email, generation: gen, showNotice: showNotice)
        }
        syncTask = task
        let result = await task.value
        if gen == generation { syncTask = nil }
        return result
    }

    private func performSync(client: APIClient, store captured: LocalStore, email: String, generation gen: Int, showNotice: Bool) async -> SyncOutcome {
        do {
            let guest = guestStore
            let transferringGuest = guest.mergeOwnerEmail == email && !guest.isEmptyForTransfer
            let sentReads = captured.record.pendingReads
            var merge = MergeRequestBody(reads: sentReads, favorites: [])
            if transferringGuest {
                let payload = guest.mergeRequestBody()
                merge.favorites = payload.favorites
                for (id, at) in payload.reads where merge.reads[id] == nil { merge.reads[id] = at }
            }
            // Existing account favorites are not re-uploaded: doing so would resurrect
            // records removed on another device. Only the guest import uses merge.
            let merged = try await client.merge(merge)
            guard gen == generation, !Task.isCancelled else { return .syncFailed }
            if let reads = merged.reads { captured.adoptServerReads(reads, acknowledging: sentReads) }
            if transferringGuest { guest.wipe() }
            while true {
                while let operation = captured.pendingOps.first {
                    switch operation.kind {
                    case .save:
                        guard let item = operation.snapshot else { throw APIError.invalidResponse }
                        try await client.addFavorite(item)
                    case .delete: try await client.deleteFavorite(id: operation.id)
                    }
                    guard gen == generation, !Task.isCancelled else { return .syncFailed }
                    // Keep the journal on disk until the server acknowledges exactly
                    // this operation. A newer same-id toggle has a different UUID.
                    captured.acknowledge(operation)
                }
                let items = try await client.favorites()
                guard gen == generation, !Task.isCancelled else { return .syncFailed }
                captured.adoptServerFavorites(items)
                publishStore()
                if !captured.record.pendingReads.isEmpty {
                    let nextReads = captured.record.pendingReads
                    let update = try await client.merge(MergeRequestBody(reads: nextReads, favorites: []))
                    guard gen == generation, !Task.isCancelled else { return .syncFailed }
                    guard let reads = update.reads else { throw APIError.invalidResponse }
                    captured.adoptServerReads(reads, acknowledging: nextReads)
                }
                if !captured.hasPendingOps && captured.record.pendingReads.isEmpty { break }
            }
            syncState = .idle
            lastSyncedAt = Date()
            if showNotice { notice = "收藏已同步。" }
            return .ok
        } catch let error as APIError where error.isUnauthorized {
            guard gen == generation else { return .syncFailed }
            sessionExpired()
            return .syncFailed
        } catch {
            guard gen == generation, !Task.isCancelled else { return .syncFailed }
            syncState = .failed("改动已保存在本机，暂未同步。请下拉重试。")
            return .syncFailed
        }
    }

    func logout() async {
        let client = api.authenticated(token: api.tokenStore.read())
        keychain.clear()
        switchAccount(email: nil)
        showLogin = false
        notice = "已退出登录，账户收藏保留在本机，下次登录后可查看。"
        // The outgoing request has an immutable token; completion cannot clear a new login.
        await client.logout()
    }

    func deleteAccountAndWipeLocalData() async {
        guard canMutateServer else { return }
        let gen = generation
        let captured = store
        let email = currentEmail
        let client = api.authenticated(token: api.tokenStore.read())
        do {
            try await client.deleteAccount()
            guard gen == generation else { return }
            captured.wipe()
            reader.wipeCurrent()
            let guest = guestStore
            if guest.mergeOwnerEmail == email { guest.wipe() }
            keychain.clear()
            switchAccount(email: nil)
            notice = "账户数据已删除。"
        } catch {
            guard gen == generation else { return }
            notice = "账户未删除：\((error as? APIError)?.userMessage ?? "请稍后重试。")"
        }
    }

    func sessionExpired() {
        keychain.clear()
        switchAccount(email: nil)
        notice = "登录已过期，本机账户收藏仍保留，请重新登录。"
        showLogin = true
    }

    private func startCooldown(_ seconds: Int) {
        resendAvailableAt = Date().addingTimeInterval(TimeInterval(max(1, seconds)))
        resendCooldown = seconds
        cooldownTimer?.invalidate()
        cooldownTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] timer in
            Task { @MainActor in
                guard let self, let date = self.resendAvailableAt else { timer.invalidate(); return }
                self.resendCooldown = max(0, Int(ceil(date.timeIntervalSinceNow)))
                if self.resendCooldown == 0 { timer.invalidate() }
            }
        }
    }
}
