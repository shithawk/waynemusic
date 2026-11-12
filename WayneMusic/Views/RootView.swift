import SwiftUI

struct RootView: View {
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var playback: PlaybackController
    @Environment(\.scenePhase) private var scenePhase

    @State private var showingPlayer = false

    var body: some View {
        ZStack {
            SongsView(showingPlayer: $showingPlayer)
            if playback.current != nil {
                NowPlayingView(showingPlayer: $showingPlayer)
                    .opacity(showingPlayer ? 1 : 0)
                    .allowsHitTesting(showingPlayer)
                    .accessibilityHidden(!showingPlayer)
            }
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            Task { await importShare() }
        }
        .onOpenURL { _ in
            Task { await importShare() }
        }
        .task {
            library.seedBundledSongsIfNeeded()
            await importShare()
        }
        .onReceive(playback.$current) { current in
            if current == nil {
                showingPlayer = false
            }
        }
        .alert(library.notice ?? "", isPresented: noticePresented) {
            Button("OK", role: .cancel) {
                library.notice = nil
            }
        }
        .alert(playback.message ?? "", isPresented: playbackMessagePresented) {
            Button("OK", role: .cancel) {
                playback.message = nil
            }
        }
    }

    private var noticePresented: Binding<Bool> {
        Binding(
            get: { library.notice != nil },
            set: { if !$0 { library.notice = nil } }
        )
    }

    private var playbackMessagePresented: Binding<Bool> {
        Binding(
            get: { playback.message != nil },
            set: { if !$0 { playback.message = nil } }
        )
    }

    private func importShare() async {
        if let message = await library.importPendingShare() {
            library.notice = message
        }
    }
}
