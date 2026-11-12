import SwiftUI

@main
struct WayneMusicApp: App {
    @StateObject private var library = LibraryStore()
    @StateObject private var playback = PlaybackController()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(library)
                .environmentObject(playback)
                .preferredColorScheme(.dark)
        }
    }
}
