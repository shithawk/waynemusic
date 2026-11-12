import SwiftUI

struct SongsView: View {
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var playback: PlaybackController
    @Binding var showingPlayer: Bool

    @State private var query = ""
    @State private var showingAdd = false
    @State private var showingManage = false

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
            ZStack(alignment: .bottomLeading) {
                CarPhoto()
                    .frame(height: 320)
                    .frame(maxWidth: .infinity)
                    .clipped()
                LinearGradient(
                    colors: [.clear, .black.opacity(0.82)],
                    startPoint: .center,
                    endPoint: .bottom
                )
                Text("Wayne's Music")
                    .font(.largeTitle.weight(.bold))
                    .foregroundColor(.white)
                    .shadow(color: .black, radius: 2, x: 0, y: 2)
                    .padding(20)
            }
            .frame(maxWidth: .infinity)
            .clipped()
            HStack(spacing: 0) {
                Theme.yellow.frame(maxWidth: .infinity).frame(height: 10)
                Theme.red.frame(maxWidth: .infinity).frame(height: 10)
            }

            Button("Add music") {
                showingAdd = true
            }
            .buttonStyle(BigButtonStyle(prominent: true))
            .padding(.horizontal, 24)

            if !library.tracks.isEmpty {
                Button("Manage songs") {
                    showingManage = true
                }
                .font(.title2.weight(.bold))
                .foregroundColor(.black)
                .frame(maxWidth: .infinity, minHeight: 64)
                .background(Color.white.opacity(0.92))
                .cornerRadius(18)
                .padding(.horizontal, 24)
            }

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
        .sheet(isPresented: $showingManage) {
            ManageSongsSheet()
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
                .foregroundColor(isCurrent ? .black : .white)
                .multilineTextAlignment(.leading)
            Text(isCurrent ? "Playing · \(track.subtitle)" : track.subtitle)
                .font(.title3)
                .foregroundColor(isCurrent ? .black.opacity(0.8) : .white.opacity(0.85))
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 22)
        .background(isCurrent ? Theme.yellow : Theme.card)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(isCurrent ? Theme.red : Theme.yellow)
                .frame(width: 10)
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(isCurrent ? Theme.red : Theme.yellow.opacity(0.35), lineWidth: 3)
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

private struct ManageSongsSheet: View {
    @EnvironmentObject private var library: LibraryStore
    @Environment(\.dismiss) private var dismiss
    @State private var songToRemove: Track?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Manage songs")
                .font(.largeTitle.weight(.bold))
                .foregroundColor(.white)
                .padding(.horizontal, 24)
                .padding(.top, 24)

            Text("Tap Remove, then confirm.")
                .font(.title2)
                .foregroundColor(.white)
                .padding(.horizontal, 24)

            if library.tracks.isEmpty {
                Text("No songs to remove.")
                    .font(.title.weight(.semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(library.tracks) { track in
                            HStack(spacing: 16) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(track.title)
                                        .font(.title2.weight(.bold))
                                        .foregroundColor(.white)
                                        .multilineTextAlignment(.leading)
                                    Text(track.subtitle)
                                        .font(.title3)
                                        .foregroundColor(.white.opacity(0.85))
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)

                                Button("Remove") {
                                    songToRemove = track
                                }
                                .font(.title3.weight(.bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 18)
                                .frame(minHeight: 64)
                                .background(Theme.red)
                                .cornerRadius(14)
                            }
                            .padding(16)
                            .background(Theme.card)
                            .cornerRadius(16)
                        }
                    }
                    .padding(.horizontal, 24)
                }
            }

            Button("Close") {
                dismiss()
            }
            .buttonStyle(BigButtonStyle(prominent: true))
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.background.ignoresSafeArea())
        .alert("Remove this song?", isPresented: removeConfirmation) {
            Button("Remove", role: .destructive) {
                if let songToRemove {
                    library.remove(songToRemove)
                }
                songToRemove = nil
            }
            Button("Keep", role: .cancel) {
                songToRemove = nil
            }
        } message: {
            Text(songToRemove?.title ?? "This song")
        }
    }

    private var removeConfirmation: Binding<Bool> {
        Binding(
            get: { songToRemove != nil },
            set: { if !$0 { songToRemove = nil } }
        )
    }
}
