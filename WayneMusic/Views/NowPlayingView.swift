import SwiftUI

struct NowPlayingView: View {
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var playback: PlaybackController
    @Binding var showingPlayer: Bool

    @State private var confirmRemove = false

    var body: some View {
        Group {
            if let track = playback.current {
                player(track)
            }
        }
        .alert("Remove this song?", isPresented: $confirmRemove) {
            Button("Remove", role: .destructive) {
                if let track = playback.current {
                    library.remove(track)
                }
                showingPlayer = false
            }
            Button("Keep", role: .cancel) {}
        } message: {
            Text(playback.current?.title ?? "This song")
        }
    }

    private func player(_ track: Track) -> some View {
        VStack(spacing: 12) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Button("Songs") {
                        showingPlayer = false
                    }
                    .buttonStyle(BigButtonStyle())
                    .frame(maxWidth: 220)

                    Text(track.title)
                        .font(.largeTitle.weight(.bold))
                        .foregroundColor(.white)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(track.subtitle)
                        .font(.title2)
                        .foregroundColor(.white.opacity(0.9))

                    stage(track)
                        .frame(maxWidth: .infinity)
                        .frame(height: 320)
                        .background(Color.black)
                        .cornerRadius(18)

                    Text(Theme.mirrorHint)
                        .font(.title3)
                        .foregroundColor(.white)
                        .fixedSize(horizontal: false, vertical: true)

                    SpeakersButton()

                    Button("Remove this song") {
                        confirmRemove = true
                    }
                    .buttonStyle(BigButtonStyle())
                }
                .padding(24)
            }

            HStack(spacing: 12) {
                Button("Previous") { playback.previous() }
                    .buttonStyle(BigButtonStyle())
                Button(playback.isPlaying ? "Pause" : "Play") { playback.toggle() }
                    .buttonStyle(BigButtonStyle(prominent: true))
                Button("Next") { playback.next() }
                    .buttonStyle(BigButtonStyle())
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
    }

    @ViewBuilder
    private func stage(_ track: Track) -> some View {
        switch track.source {
        case .local:
            localArtwork(track)
        case .youtube:
            YouTubePlayerView(videoID: track.mediaRef)
        case .soundcloud:
            SoundCloudPlayerView(pageURL: track.mediaRef)
        }
    }

    @ViewBuilder
    private func localArtwork(_ track: Track) -> some View {
        if let artworkRef = track.artworkRef,
           let image = UIImage(contentsOfFile: library.fileURL(named: artworkRef).path) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
        } else {
            Text(track.title)
                .font(.largeTitle.weight(.bold))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
