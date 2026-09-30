import SwiftUI
import UIKit

@main
struct AquaSightApp: App {
    @StateObject private var app: AppModel

    init() {
        Self.configureAppearance()
        let services = AppServices.shared
        let model = AppModel(
            api: services.api,
            keychain: services.keychain,
            storeDirectory: services.storeDirectory
        )
        #if DEBUG
        if let preview = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--preview-tab=") }),
           let tab = Tab(rawValue: String(preview.dropFirst("--preview-tab=".count))) { model.selectedTab = [.reading, .subscriptions, .saved].contains(tab) ? tab : .reading }
        if let preview = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--preview-event=") }) {
            let id = String(preview.dropFirst("--preview-event=".count))
            if !id.isEmpty { model.deepLinkEventId = id }
        }
        #endif
        _app = StateObject(wrappedValue: model)
    }

    private static func configureAppearance() {
        let appearance = UITabBarAppearance()
        appearance.configureWithDefaultBackground()
        for layout in [appearance.stackedLayoutAppearance, appearance.inlineLayoutAppearance, appearance.compactInlineLayoutAppearance] {
            layout.normal.iconColor = .secondaryLabel
            layout.normal.titleTextAttributes = [.foregroundColor: UIColor.secondaryLabel]
            layout.selected.iconColor = UIColor(named: "AccentColor")
            layout.selected.titleTextAttributes = [.foregroundColor: UIColor(named: "AccentColor") ?? UIColor.systemGreen]
        }
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
        UITabBar.appearance().unselectedItemTintColor = .secondaryLabel
    }

    /// UI tests get an isolated, resettable container; production uses the
    /// default Application Support location.
    static func storeDirectory() -> URL? {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-uiTestFixtures") || AppServices.integrationBase != nil {
            let dir = FileManager.default.temporaryDirectory
                .appendingPathComponent("aquasight-uitest-store", isDirectory: true)
            if args.contains("-uiTestResetStore") {
                try? FileManager.default.removeItem(at: dir)
            }
            return dir
        }
        #endif
        return nil
    }

    static func makeSession() -> URLSession {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 20
        cfg.timeoutIntervalForResource = 45
        // No cookies ever: the web session cookie must not outlive logout.
        cfg.httpShouldSetCookies = false
        cfg.httpCookieAcceptPolicy = .never
        cfg.httpCookieStorage = nil
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-uiTestFixtures") {
            FixturesURLProtocol.reset()
            FixturesURLProtocol.forceErrorOnce = ProcessInfo.processInfo.arguments.contains("-uiTestError")
            cfg.protocolClasses = [FixturesURLProtocol.self]
            cfg.timeoutIntervalForRequest = 10
        }
        #endif
        return URLSession(configuration: cfg)
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(app)
                #if DEBUG
                .preferredColorScheme(ProcessInfo.processInfo.arguments.contains("-uiTestFixtures") && ProcessInfo.processInfo.arguments.contains("Dark") ? .dark : nil)
                #endif
                .onOpenURL { url in
                    // Only our own scheme is handled. Universal links are NOT
                    // claimed (no associated domain is registered), and https
                    // is never registered as a custom scheme.
                    guard url.scheme?.lowercased() == "aquasight" else { return }
                    guard let id = Self.eventId(from: url) else { return }
                    app.deepLinkEventId = id
                }
        }
    }

    /// aquasight://event/<id> (also tolerates aquasight://events/<id>).
    /// Unknown hosts/schemes are rejected.
    static func eventId(from url: URL) -> String? {
        guard url.scheme?.lowercased() == "aquasight" else { return nil }
        guard url.user == nil, url.password == nil, url.port == nil,
              url.query == nil, url.fragment == nil,
              ["event", "events"].contains(url.host?.lowercased() ?? ""),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let segments = components.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: true)
        guard segments.count == 1, let id = String(segments[0]).removingPercentEncoding, !id.isEmpty else { return nil }
        return id
    }
}
