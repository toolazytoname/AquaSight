import Foundation

@MainActor
final class AppServices {
    static let shared = AppServices()
    let api: APIClient
    let keychain: KeychainStore
    let storeDirectory: URL?
    let cacheDirectory: URL?
    /// Loopback-only real HTTP integration; compiled out of device and Release builds.
    static var integrationBase: URL? {
        #if DEBUG && targetEnvironment(simulator)
        guard ProcessInfo.processInfo.arguments.contains("-uiTestIntegration"),
              let raw = ProcessInfo.processInfo.environment["AQUASIGHT_INTEGRATION_BASE"],
              let url = URL(string: raw), url.scheme == "http", url.host == "127.0.0.1",
              url.user == nil, url.password == nil, url.port != nil else { return nil }
        return url
        #else
        return nil
        #endif
    }
    init() {
        #if DEBUG
        let testMode = ProcessInfo.processInfo.arguments.contains("-uiTestFixtures") || Self.integrationBase != nil
        keychain = KeychainStore(service: testMode ? "com.aquasight.uitest" : "com.aquasight.app")
        if testMode, ProcessInfo.processInfo.arguments.contains("-uiTestResetStore") { keychain.clear() }
        #else
        keychain = KeychainStore(service: "com.aquasight.app")
        #endif
        storeDirectory = AquaSightApp.storeDirectory()
        cacheDirectory = storeDirectory?.appendingPathComponent("feed-cache", isDirectory: true)
        api = APIClient(base: Self.integrationBase ?? URL(string: "https://quack.weichao.ren")!, tokenStore: keychain, session: AquaSightApp.makeSession())
    }
}
