import Foundation

enum TrackSource: String, Codable, Equatable {
    case local
    case youtube
    case soundcloud

    var label: String {
        switch self {
        case .local: return "My Music"
        case .youtube: return "YouTube"
        case .soundcloud: return "SoundCloud"
        }
    }
}

struct Track: Identifiable, Codable, Equatable {
    var id: UUID
    var title: String
    var artist: String
    var source: TrackSource
    var mediaRef: String
    var artworkRef: String?
    var createdAt: Date

    var subtitle: String {
        if artist.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return source.label
        }
        return "\(artist) · \(source.label)"
    }
}
