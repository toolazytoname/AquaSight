import SwiftUI

struct RootTabView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $app.selectedTab) {
            ReaderTabView(reader: app.reader)
            SubscriptionsTabView(reader: app.reader).id(app.reader.accountKey)
            SavedTabView()
        }
        .environmentObject(app.reader)
        .tint(Color("AccentColor"))
        .task { if app.auth == .unknown { await app.restoreSession() } }
        .task(id: app.notice) {
            guard let message = app.notice else { return }
            do { try await Task.sleep(nanoseconds: 6_000_000_000) } catch { return }
            if app.notice == message { app.notice = nil }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, app.currentEmail != nil { Task { await app.syncNow(showNotice: false) } }
        }
        .sheet(isPresented: $app.showLogin) { LoginSheet() }
        // Central deep-link routing: one consumer, presented above whatever
        // tab is selected — no per-tab race, no lost taps.
        .sheet(item: Binding(
            get: { app.deepLinkEventId.map { DeepLinkTarget(id: $0) } },
            set: { _ in app.deepLinkEventId = nil }
        )) { target in
            NavigationStack {
                EventDetailView(eventId: target.id, fallback: app.savedItems.first { $0.id == target.id })
                    .toolbar { ToolbarItem(placement: .topBarLeading) { Button("完成") { app.deepLinkEventId = nil } } }
            }
            .environmentObject(app)
            .environmentObject(app.reader)
        }
    }
}

struct DeepLinkTarget: Identifiable {
    let id: String
}

/// A reading tab: search, paginated list, pull-to-refresh, error/empty states.
struct FeedTabView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var reader: ReaderModel
    @StateObject private var feed: EventFeedModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @FocusState private var searchFocused: Bool
    @Environment(\.scenePhase) private var scenePhase

    private let tab: Tab

    init(view: String, tab: Tab, reader: ReaderModel? = nil) {
        _feed = StateObject(wrappedValue: EventFeedModel(view: view, api: reader?.client ?? AppServices.shared.api, cacheDirectory: AppServices.shared.cacheDirectory, readerSources: reader?.effectiveSources, cacheKey: reader?.scopeKey))
        self.tab = tab
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(tab.title)
                .navigationBarTitleDisplayMode(.large)
                .toolbar { toolbarContent }
        }
        .tabItem { Label(tab.title, systemImage: tab.systemImage) }
        .tag(tab)
        .task { feed.refreshIfStale() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { feed.refreshIfStale() } }

    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) { AboutButton() }
        ToolbarItem(placement: .principal) {
            Text("鸭先知")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Color("AccentColor"))
                .accessibilityLabel("鸭先知")
        }
        ToolbarItem(placement: .topBarTrailing) {
            if case .loggedIn(let email) = app.auth {
                Menu {
                    Text(email)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button {
                        Task { await app.syncNow(showNotice: true) }
                    } label: {
                        Label("同步收藏", systemImage: "arrow.triangle.2.circlepath")
                    }
                    Button(role: .destructive) {
                        Task { await app.logout() }
                    } label: {
                        Label("退出登录", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } label: {
                    Image(systemName: "person.crop.circle")
                }
                .accessibilityLabel("账户")
            } else {
                Button("登录") { app.showLogin = true }
                    .accessibilityLabel("登录")
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        List {
            if feed.view == "reader" {
                Section {
                    let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12)) : AnyLayout(HStackLayout(alignment: .top))
                    layout {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("为你留一段阅读时间").font(.title3.weight(.semibold))
                            Text("\(reader.effectiveSources.count) 个关注来源 · AI 辅助阅读")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                        Button("管理订阅") { app.selectedTab = .subscriptions }
                            .font(.subheadline.weight(.medium)).frame(minHeight: 44)
                    }
                    .padding(.vertical, 10)
                    .listRowSeparator(.hidden)
                }
            }
            Section {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("搜索标题或概述", text: Binding(
                        get: { feed.query },
                        set: { feed.setQuery($0) }
                    ))
                    .focused($searchFocused)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit { searchFocused = false }
                    .accessibilityLabel("搜索\(tab.title)")
                    if !feed.query.isEmpty {
                        Button {
                            searchFocused = false
                            feed.setQuery("")
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityLabel("清除搜索")
                    }
                }
                .padding(12)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                .listRowSeparator(.hidden)
            }

            if feed.view == "reader", let message = reader.message {
                Section { WarningBanner(message: message) { Task { await reader.refresh() } } }
            }
            if let warning = feed.warning {
                Section {
                    WarningBanner(message: warning) {
                        Task { await feed.retry() }
                    }
                    .listRowSeparator(.hidden)
                }
            }

            switch feed.phase {
            case .failed(let message):
                Section {
                    ErrorStateView(message: message) {
                        Task { await feed.retry() }
                    }
                    .listRowSeparator(.hidden)
                }
            default:
                Section {
                    if case .loading = feed.phase, feed.items.isEmpty {
                        HStack { Spacer(); ProgressView(); Spacer() }
                            .listRowSeparator(.hidden)
                            .accessibilityLabel("加载中")
                    }
                    if feed.view == "digest", feed.digestMissing, feed.items.isEmpty {
                        EmptyStateView(
                            title: "今日早报还没有生成",
                            subtitle: "早报按北京时间每天生成一次，稍后再来看看。"
                        )
                        .listRowSeparator(.hidden)
                    } else if feed.items.isEmpty, case .loaded = feed.phase {
                        EmptyStateView(
                            title: feed.query.isEmpty ? "暂时没有内容" : "没有符合条件的内容",
                            subtitle: feed.query.isEmpty ? "下拉刷新再看看。" : "换个关键词或点 × 清除搜索。"
                        )
                        .listRowSeparator(.hidden)
                    }
                    ForEach(feed.items) { item in
                        EventRowView(item: item)
                        .listRowSeparator(.visible)
                        .task { await feed.loadMoreIfNeeded(current: item) }
                    }
                    if feed.refreshing || feed.loadingMore, !feed.items.isEmpty {
                        HStack { Spacer(); ProgressView(); Spacer() }
                            .listRowSeparator(.hidden)
                    }
                } header: {
                    if feed.view == "digest", let date = feed.digestDate, !feed.digestMissing {
                        Text("早报 · \(date)（北京时间）").font(.footnote)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color("LaunchBackground"))
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        .safeAreaInset(edge: .bottom) {
            if let notice = app.notice { NoticeBar(text: notice) { app.notice = nil } }
        }
        .scrollDismissesKeyboard(.immediately)
        .refreshable { await feed.refresh() }
        .navigationDestination(for: String.self) { eventId in
            EventDetailView(eventId: eventId, fallback: feed.items.first { $0.id == eventId })
        }
    }
}

// MARK: - Saved tab

struct SavedTabView: View {
    @EnvironmentObject private var app: AppModel
    @State private var query = ""
    @State private var showDeleteConfirm = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(app.currentEmail == nil ? "随时回来，接着读" : "你的私人阅读清单", systemImage: "bookmark")
                            .font(.title3.weight(.semibold)).foregroundStyle(Color("AccentColor"))
                        Text(app.currentEmail == nil ? "收藏保存在本机，登录后可与网页同步。" : "\(app.savedItems.count) 篇收藏 · 同步至 \(app.currentEmail ?? "")")
                            .font(.footnote).foregroundStyle(.secondary)
                        if app.currentEmail == nil {
                            Button("登录并同步收藏") { app.showLogin = true }.font(.subheadline).frame(minHeight: 44)
                        } else if let date = app.lastSyncedAt, app.syncState == .idle {
                            Text("上次同步 \(date.formatted(date: .omitted, time: .shortened)) · 下拉可刷新")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 10).listRowSeparator(.hidden)
                }
                Section {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("搜索收藏", text: $query)
                            .autocorrectionDisabled()
                            .accessibilityLabel("搜索收藏")
                        if !query.isEmpty {
                            Button { query = "" } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                            }
                            .frame(minWidth: 44, minHeight: 44)
                        .accessibilityLabel("清除搜索")
                        }
                    }
                    .padding(12)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    .listRowSeparator(.hidden)
                }

                if app.syncState == .syncing {
                    Section {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("正在同步收藏…").font(.footnote).foregroundStyle(.secondary)
                        }
                        .listRowSeparator(.hidden)
                    }
                }
                if case .failed(let msg) = app.syncState {
                    Section {
                        WarningBanner(message: msg) {
                            Task { await app.syncNow(showNotice: true) }
                        }
                        .listRowSeparator(.hidden)
                    }
                }

                Section {
                    let items = filtered
                    if items.isEmpty {
                        EmptyStateView(
                            title: query.isEmpty ? "还没有收藏" : "没有匹配的收藏",
                            subtitle: query.isEmpty ? "阅读时点「收藏」，离线也能看。" : "换个关键词试试。"
                        )
                        .listRowSeparator(.hidden)
                    }
                    ForEach(items) { item in
                        EventRowView(item: item)
                        .listRowSeparator(.visible)
                    }
                }
            }
            .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color("LaunchBackground"))
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
            .safeAreaInset(edge: .bottom) {
                if let notice = app.notice { NoticeBar(text: notice) { app.notice = nil } }
            }
            .scrollDismissesKeyboard(.immediately)
            .navigationTitle("收藏")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { AboutButton() }
                ToolbarItem(placement: .topBarTrailing) { accountMenu }
            }
            .task { await app.syncNow(showNotice: false) }
            .refreshable { await app.syncNow(showNotice: true) }
            .navigationDestination(for: String.self) { eventId in
                EventDetailView(eventId: eventId, fallback: app.savedItems.first { $0.id == eventId })
            }
            .confirmationDialog("删除账户全部数据？", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
                Button("删除账户数据", role: .destructive) {
                    Task { await app.deleteAccountAndWipeLocalData() }
                }
                Button("取消", role: .cancel) {}
            } message: {
                Text("将从服务器删除账户的收藏、阅读记录与设置，并清除此账户的本机数据。此操作不可撤销。")
            }
        }
        .tabItem { Label("收藏", systemImage: "bookmark.fill") }
        .tag(Tab.saved)
    }

    @ViewBuilder
    private var accountMenu: some View {
        switch app.auth {
        case .loggedIn(let email):
            Menu {
                Text(email).font(.footnote).foregroundStyle(.secondary)
                Button {
                    Task { await app.syncNow(showNotice: true) }
                } label: {
                    Label("立即同步", systemImage: "arrow.triangle.2.circlepath")
                }
                Button(role: .destructive) {
                    Task { await app.logout() }
                } label: {
                    Label("退出登录", systemImage: "rectangle.portrait.and.arrow.right")
                }
                Divider()
                Button(role: .destructive) {
                    showDeleteConfirm = true
                } label: {
                    Label("删除账户数据…", systemImage: "trash")
                }
            } label: {
                Image(systemName: "person.crop.circle")
            }
            .accessibilityLabel("账户")
        default:
            Button("登录") { app.showLogin = true }
                .accessibilityLabel("登录")
        }
    }

    private var filtered: [EventItem] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return app.savedItems }
        return app.savedItems.filter {
            ($0.displayTitle + " " + $0.overviewText).lowercased().contains(q)
        }
    }
}


struct AboutButton: View {
    @State private var presented = false
    var body: some View {
        Button { presented = true } label: { Image(systemName: "info.circle") }
            .accessibilityLabel("关于与帮助")
            .sheet(isPresented: $presented) { AboutView() }
    }
}

struct AboutView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section("鸭先知") {
                    Text("按自己的关注订阅信息，阅读技术更新与开源项目，收藏值得回看的内容。")
                    LabeledContent("版本", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                }
                Section("隐私与支持") {
                    Link("隐私政策", destination: URL(string: "https://quack.weichao.ren/privacy.html")!)
                    Link("帮助与支持", destination: URL(string: "https://quack.weichao.ren/support.html")!)
                    Link("联系支持：lazywc@gmail.com", destination: URL(string: "mailto:lazywc@gmail.com")!)
                }
                Section("账户与收藏") {
                    Text("未登录时收藏保存在本机。登录后可同步收藏和阅读记录。退出登录会隐藏该账户的收藏，已下载的副本仍保留在本机。")
                    Text("如需删除账户，请进入「收藏」，打开右上角「账户」菜单，选择「删除账户数据」。删除前会再次确认。")
                }
                Section("内容说明") {
                    Text("AI 摘要可能存在遗漏或错误，请结合详情中的原始来源核实。文章和项目的权利归其原作者所有。")
                    Text("发现内容错误或权利问题，可通过支持邮箱提供原始链接与说明。请勿发送验证码或登录凭据。")
                }
            }
            .navigationTitle("关于与帮助")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
        .tint(Color("AccentColor"))
    }
}

// MARK: - Personal reading and subscription management

struct ReaderTabView: View {
    @EnvironmentObject private var app: AppModel
    @ObservedObject var reader: ReaderModel
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        Group {
            if reader.effectiveSources.isEmpty {
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            Image(systemName: "text.book.closed")
                                .font(.system(size: 42, weight: .light))
                                .foregroundStyle(Color("AccentColor"))
                                .padding(.top, 44)
                            Text("从你关心的开始。")
                                .font(.system(.largeTitle, design: .serif).bold())
                            Text("选几个来源，把开源项目、技术更新与研究动态放进自己的阅读清单。")
                                .font(.body).foregroundStyle(.secondary).lineSpacing(5)
                            Button { app.selectedTab = .subscriptions } label: {
                                Label("选择信息源", systemImage: "plus")
                                    .font(.headline).frame(maxWidth: .infinity, minHeight: 44)
                            }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                            Text("无需登录即可开始。收藏的内容也能离线阅读。")
                                .font(.footnote).foregroundStyle(.secondary)
                            if let message = reader.message {
                                WarningBanner(message: message) { Task { await reader.refresh() } }
                            }
                        }
                        .padding(24).frame(maxWidth: 620).frame(maxWidth: .infinity)
                    }
                    .background(Color("LaunchBackground"))
                    .navigationTitle("阅读")
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) { AboutButton() }
                        ToolbarItem(placement: .topBarTrailing) {
                            if app.currentEmail == nil { Button("登录") { app.showLogin = true } }
                        }
                    }
                }
            } else {
                FeedTabView(view: "reader", tab: .reading, reader: reader).id(reader.scopeKey)
            }
        }
        .tabItem { Label("阅读", systemImage: "text.book.closed") }.tag(Tab.reading)
        .task(id: app.auth) { if app.auth != .unknown { await reader.refresh() } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await reader.refresh() } }
        }
    }
}

struct SubscriptionsTabView: View {
    @EnvironmentObject private var app: AppModel
    @ObservedObject var reader: ReaderModel
    @State private var draft = Set<String>()
    @State private var dirty = false
    private var available: [ReaderSource] { reader.catalog.filter { !$0.extended || reader.canUseMore } }
    private var count: Int { available.filter { draft.contains($0.id) }.count }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("少一些噪声，多一些关注。")
                            .font(.title2.weight(.semibold))
                        Text("选择你想读的来源。取消订阅不会删除收藏，也不会开启通知。")
                            .font(.subheadline).foregroundStyle(.secondary).lineSpacing(3)
                        if !reader.settings.configured && draft.isEmpty {
                            Button("从开源与技术更新开始") {
                                draft = ["github-maintained", "openai", "huggingface"]; dirty = true
                            }
                            .buttonStyle(.bordered).frame(minHeight: 44)
                            .accessibilityIdentifier("reader-starter")
                        }
                    }.padding(.vertical, 8)
                }
                if let message = reader.message {
                    Section { WarningBanner(message: message) { Task { await reader.refresh() } } }
                }
                ForEach(reader.groups, id: \.self) { group in
                    let sources = available.filter { $0.group == group }
                    if !sources.isEmpty {
                        Section(group) {
                            ForEach(sources) { source in
                                Button {
                                    if draft.contains(source.id) { draft.remove(source.id) } else { draft.insert(source.id) }
                                    dirty = true
                                } label: {
                                    HStack(alignment: .center, spacing: 14) {
                                        Image(systemName: source.id.hasPrefix("github") ? "chevron.left.forwardslash.chevron.right" : (source.extended ? "globe" : "sparkle.magnifyingglass"))
                                            .font(.body.weight(.medium)).foregroundStyle(Color("AccentColor"))
                                            .frame(width: 40, height: 40)
                                            .background(Color("AccentColor").opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
                                        VStack(alignment: .leading, spacing: 5) {
                                            Text(source.label).font(.body.weight(.medium)).foregroundStyle(.primary)
                                            Text(source.description).font(.caption).foregroundStyle(.secondary)
                                                .fixedSize(horizontal: false, vertical: true)
                                        }
                                        Spacer(minLength: 4)
                                        Image(systemName: draft.contains(source.id) ? "checkmark.circle.fill" : "circle")
                                            .font(.title2)
                                            .foregroundStyle(draft.contains(source.id) ? Color("AccentColor") : .secondary)
                                    }.padding(.vertical, 6).frame(minHeight: 52).contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(source.label)
                                .accessibilityValue(draft.contains(source.id) ? "已选择" : "未选择")
                                .accessibilityIdentifier("source-\(source.id)")
                                .disabled(reader.isSaving)
                            }
                        }
                    }
                }
                Section {
                    Label(reader.canUseMore ? "更多信息源已开启" : "想关注更多领域？", systemImage: "slider.horizontal.3")
                        .font(.headline)
                    Text("在网页个人设置中开启更多信息源，再回来选择订阅。设置只对你的账户生效。")
                        .font(.subheadline).foregroundStyle(.secondary)
                    if app.currentEmail != nil {
                        Link(destination: URL(string: "https://quack.weichao.ren/#/reader-settings")!) {
                            Label("打开网页个人设置", systemImage: "arrow.up.right.square").frame(minHeight: 44)
                        }
                        Button { Task { await reader.refresh() } } label: {
                            Label("刷新账户设置", systemImage: "arrow.clockwise").frame(minHeight: 44)
                        }.disabled(reader.isRefreshing || reader.isSaving)
                    } else {
                        Button("登录并同步订阅") { app.showLogin = true }.frame(minHeight: 44)
                    }
                } footer: {
                    Text(app.currentEmail == nil ? "当前选择保存在这台设备。登录后可同步到你的账户。" : "账户订阅在网页和 App 间同步；返回 App 时会自动刷新。")
                }
            }
            .listStyle(.insetGrouped)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            .scrollContentBackground(.hidden)
            .background(Color("LaunchBackground"))
            .navigationTitle("订阅")
            .toolbar { ToolbarItem(placement: .topBarLeading) { AboutButton() } }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 6) {
                    HStack {
                        Text("已选 \(count) 个来源").font(.subheadline).foregroundStyle(.secondary)
                        Spacer()
                        if dirty { Button("还原") { restoreDraft() }.frame(minHeight: 44) }
                        Button {
                            let selection = Array(draft)
                            Task {
                                await reader.select(selection)
                                restoreDraft()
                                if reader.message == nil { app.selectedTab = .reading }
                            }
                        } label: {
                            if reader.isSaving { ProgressView().frame(width: 90, height: 28) }
                            else { Text("保存订阅").frame(minWidth: 90, minHeight: 28) }
                        }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                        .disabled(!dirty || reader.isSaving || reader.isRefreshing)
                        .accessibilityIdentifier("save-subscriptions")
                    }
                    if reader.hasPendingChanges { Text("本机已保存 · 等待同步").font(.caption).foregroundStyle(.secondary) }
                }.padding(.horizontal, 20).padding(.vertical, 10)
                    .frame(maxWidth: 760).frame(maxWidth: .infinity).background(.regularMaterial)
            }
            .onAppear { restoreDraft() }
            .onChange(of: reader.settings) { _, _ in if !dirty { restoreDraft() } }
            .refreshable { await reader.refresh() }
        }
        .tabItem { Label("订阅", systemImage: "square.stack.3d.up") }.tag(Tab.subscriptions)
    }
    private func restoreDraft() { draft = Set(reader.settings.selectedSources); dirty = false }
}
