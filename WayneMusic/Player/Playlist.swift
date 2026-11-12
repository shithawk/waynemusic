import Foundation

enum Playlist {
    static func next(after id: UUID, in tracks: [Track]) -> Track? {
        neighbor(of: id, in: tracks, step: 1)
    }

    static func previous(before id: UUID, in tracks: [Track]) -> Track? {
        neighbor(of: id, in: tracks, step: -1)
    }

    private static func neighbor(of id: UUID, in tracks: [Track], step: Int) -> Track? {
        guard !tracks.isEmpty else { return nil }
        guard let index = tracks.firstIndex(where: { $0.id == id }) else {
            return tracks.first
        }
        let nextIndex = (index + step + tracks.count) % tracks.count
        return tracks[nextIndex]
    }
}
