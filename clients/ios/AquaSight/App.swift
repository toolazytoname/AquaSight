import SwiftUI

@main
struct AquaSightApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .onOpenURL { url in
                    // https://host/#/event/<id>
                    _ = url.fragment
                }
        }
    }
}

struct ContentView: View {
    var body: some View {
        NavigationStack {
            Text("鸭先知")
                .navigationTitle("精选")
        }
    }
}
