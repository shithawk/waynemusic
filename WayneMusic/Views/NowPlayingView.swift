import SwiftUI

struct NowPlayingView: View {
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var playback: PlaybackController
    @Binding var showingPlayer: Bool

    var body: some View {
        Group {
            if let track = playback.current {
                player(track)
            }
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
                }
                .padding(24)
            }

            HStack(spacing: 12) {
                transportButton(title: "Previous", systemImage: "backward.end.fill", prominent: false) {
                    playback.previous()
                }
                transportButton(
                    title: playback.isPlaying ? "Pause" : "Play",
                    systemImage: playback.isPlaying ? "pause.fill" : "play.fill",
                    prominent: true
                ) {
                    playback.toggle()
                }
                transportButton(title: "Next", systemImage: "forward.end.fill", prominent: false) {
                    playback.next()
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
    }

    private func transportButton(title: String, systemImage: String, prominent: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 36, weight: .bold))
                    .accessibilityHidden(true)
                Text(title)
            }
        }
        .buttonStyle(BigButtonStyle(prominent: prominent))
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
            CarPhoto()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
        }
    }
}
