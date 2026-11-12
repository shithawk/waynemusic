import SwiftUI

struct SongsView: View {
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var playback: PlaybackController
    @Binding var showingPlayer: Bool

    @State private var query = ""
    @State private var showingAdd = false

    private var visibleTracks: [Track] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return library.tracks }
        return library.tracks.filter { track in
            track.title.localizedCaseInsensitiveContains(trimmed)
                || track.artist.localizedCaseInsensitiveContains(trimmed)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Wayne's Music")
                .font(.largeTitle.weight(.bold))
                .foregroundColor(.white)
                .padding(.horizontal, 24)
                .padding(.top, 12)

            Button("Add music") {
                showingAdd = true
            }
            .buttonStyle(BigButtonStyle(prominent: true))
            .padding(.horizontal, 24)

            if library.tracks.isEmpty {
                Text("Your songs will show up here.")
                    .font(.title.weight(.semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Find a song")
                        .font(.title3.weight(.semibold))
                        .foregroundColor(.white)
                    TextField("Song or artist", text: $query)
                        .font(.title2)
                        .foregroundColor(.white)
                        .padding(16)
                        .background(Theme.card)
                        .cornerRadius(14)
                        .accessibilityLabel("Find a song")
                }
                .padding(.horizontal, 24)

                ScrollView {
                    LazyVStack(spacing: 12) {
                        if visibleTracks.isEmpty {
                            Text("No songs match that.")
                                .font(.title2)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 12)
                        }
                        ForEach(visibleTracks) { track in
                            Button {
                                play(track)
                            } label: {
                                songRow(track)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 12)
                }
            }

            if playback.current != nil {
                Button {
                    showingPlayer = true
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Now playing")
                            .font(.title3.weight(.semibold))
                        Text(playback.current?.title ?? "")
                            .font(.title2.weight(.bold))
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(BigButtonStyle())
                .padding(.horizontal, 24)
                .padding(.bottom, 8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.background.ignoresSafeArea())
        .sheet(isPresented: $showingAdd) {
            AddTrackSheet()
                .environmentObject(library)
        }
        .onReceive(library.$tracks) { tracks in
            playback.updateQueue(tracks)
        }
    }

    private func songRow(_ track: Track) -> some View {
        let isCurrent = playback.current?.id == track.id
        return VStack(alignment: .leading, spacing: 6) {
            Text(track.title)
                .font(.title.weight(.bold))
                .foregroundColor(.white)
                .multilineTextAlignment(.leading)
            Text(isCurrent ? "Playing · \(track.subtitle)" : track.subtitle)
                .font(.title3)
                .foregroundColor(isCurrent ? .yellow : .white.opacity(0.85))
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 22)
        .background(isCurrent ? Color.white.opacity(0.18) : Theme.card)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(isCurrent ? Color.yellow : Color.clear, lineWidth: 3)
        )
    }

    private func play(_ track: Track) {
        if playback.current?.id == track.id {
            if !playback.isPlaying {
                playback.toggle()
            }
        } else {
            playback.play(track)
        }
        showingPlayer = true
    }
}
