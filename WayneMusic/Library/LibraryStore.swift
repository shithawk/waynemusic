import AVFoundation
import Foundation

enum LibraryError: LocalizedError {
    case invalidLink
    case duplicate
    case unreadableFile

    var errorDescription: String? {
        switch self {
        case .invalidLink:
            return "Use a YouTube or SoundCloud link."
        case .duplicate:
            return "That song is already in the list."
        case .unreadableFile:
            return "That song could not be added."
        }
    }
}

@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var tracks: [Track] = []
    @Published var notice: String?

    private let baseDirectory: URL
    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()
    private let decoder = JSONDecoder()

    init(baseDirectory: URL? = nil) {
        if let baseDirectory {
            self.baseDirectory = baseDirectory
        } else {
            let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            self.baseDirectory = appSupport.appendingPathComponent("WayneMusic", isDirectory: true)
        }
        try? FileManager.default.createDirectory(at: self.baseDirectory, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: musicDirectory, withIntermediateDirectories: true)
        reload()
    }

    func reload() {
        let url = libraryFileURL
        guard let data = try? Data(contentsOf: url),
              let decoded = try? decoder.decode([Track].self, from: data) else {
            tracks = []
            return
        }
        tracks = decoded
        sortTracks()
    }

    func importFiles(_ urls: [URL]) async -> String {
        var titles: [String] = []
        var failures = 0
        for url in urls {
            let access = url.startAccessingSecurityScopedResource()
            defer {
                if access { url.stopAccessingSecurityScopedResource() }
            }
            do {
                titles.append(try await importFile(url))
            } catch {
                failures += 1
            }
        }
        if titles.count == 1 && failures == 0 {
            return "Added \(titles[0])"
        }
        if titles.count > 1 && failures == 0 {
            return "Added \(titles.count) songs"
        }
        if titles.isEmpty {
            return "That song could not be added."
        }
        return "Added \(titles.count) songs. \(failures) could not be added."
    }

    func addLink(_ text: String) async throws -> String {
        guard let parsed = LinkParser.parse(text) else {
            throw LibraryError.invalidLink
        }
        let source: TrackSource
        let mediaRef: String
        switch parsed {
        case .youtube(let id, _):
            source = .youtube
            mediaRef = id
        case .soundcloud(let pageURL):
            source = .soundcloud
            mediaRef = pageURL.absoluteString
        }
        if tracks.contains(where: { $0.source == source && $0.mediaRef == mediaRef }) {
            throw LibraryError.duplicate
        }
        let metadata = await fetchOEmbed(parsed)
        let track = Track(
            id: UUID(),
            title: metadata.title,
            artist: metadata.artist,
            source: source,
            mediaRef: mediaRef,
            artworkRef: metadata.artworkURL,
            createdAt: Date()
        )
        tracks.append(track)
        sortTracks()
        try? save()
        return track.title
    }

    func importPendingShare() async -> String? {
        guard let defaults = UserDefaults(suiteName: AppGroup.id),
              let raw = defaults.string(forKey: AppGroup.pendingURLKey) else {
            return nil
        }
        defaults.removeObject(forKey: AppGroup.pendingURLKey)
        do {
            let title = try await addLink(raw)
            return "Added \(title)"
        } catch let error as LibraryError {
            return error.localizedDescription
        } catch {
            return "That link could not be added."
        }
    }

    func remove(_ track: Track) {
        if track.source == .local {
            try? FileManager.default.removeItem(at: fileURL(named: track.mediaRef))
            if let artworkRef = track.artworkRef {
                try? FileManager.default.removeItem(at: fileURL(named: artworkRef))
            }
        }
        tracks.removeAll { $0.id == track.id }
        try? save()
    }

    func fileURL(named filename: String) -> URL {
        musicDirectory.appendingPathComponent(filename)
    }

    func add(_ track: Track) {
        tracks.append(track)
        sortTracks()
        try? save()
    }

    private var musicDirectory: URL {
        baseDirectory.appendingPathComponent("Music", isDirectory: true)
    }

    private var libraryFileURL: URL {
        baseDirectory.appendingPathComponent("library.json")
    }

    private func importFile(_ url: URL) async throws -> String {
        let ext = url.pathExtension.isEmpty ? "mp3" : url.pathExtension.lowercased()
        let filename = "\(UUID().uuidString).\(ext)"
        let destination = fileURL(named: filename)
        do {
            try FileManager.default.copyItem(at: url, to: destination)
        } catch {
            throw LibraryError.unreadableFile
        }
        let metadata = await readMetadata(url: destination)
        let fallback = url.deletingPathExtension().lastPathComponent
        let title = cleaned(metadata.title) ?? (fallback.isEmpty ? "Song" : fallback)
        var artworkName: String?
        if let artwork = metadata.artwork {
            let name = "\(UUID().uuidString).jpg"
            if (try? artwork.write(to: fileURL(named: name), options: .atomic)) != nil {
                artworkName = name
            }
        }
        let track = Track(
            id: UUID(),
            title: title,
            artist: cleaned(metadata.artist) ?? "",
            source: .local,
            mediaRef: filename,
            artworkRef: artworkName,
            createdAt: Date()
        )
        tracks.append(track)
        sortTracks()
        try? save()
        return title
    }

    private func readMetadata(url: URL) async -> (title: String?, artist: String?, artwork: Data?) {
        let asset = AVURLAsset(url: url)
        guard let items = try? await asset.load(.commonMetadata) else {
            return (nil, nil, nil)
        }
        var title: String?
        var artist: String?
        var artwork: Data?
        for item in items {
            if item.commonKey == .commonKeyTitle {
                title = try? await item.load(.stringValue)
            } else if item.commonKey == .commonKeyArtist {
                artist = try? await item.load(.stringValue)
            } else if item.commonKey == .commonKeyArtwork {
                artwork = try? await item.load(.dataValue)
            }
        }
        return (title, artist, artwork)
    }

    private func fetchOEmbed(_ link: ParsedLink) async -> (title: String, artist: String, artworkURL: String?) {
        let endpoint: URL?
        let fallbackTitle: String
        switch link {
        case .youtube(_, let pageURL):
            fallbackTitle = "YouTube video"
            var components = URLComponents(string: "https://www.youtube.com/oembed")
            components?.queryItems = [
                URLQueryItem(name: "format", value: "json"),
                URLQueryItem(name: "url", value: pageURL.absoluteString)
            ]
            endpoint = components?.url
        case .soundcloud(let pageURL):
            fallbackTitle = "SoundCloud song"
            var components = URLComponents(string: "https://soundcloud.com/oembed")
            components?.queryItems = [
                URLQueryItem(name: "format", value: "json"),
                URLQueryItem(name: "url", value: pageURL.absoluteString)
            ]
            endpoint = components?.url
        }
        guard let endpoint,
              let (data, response) = try? await URLSession.shared.data(from: endpoint),
              let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode),
              let payload = try? JSONDecoder().decode(OEmbedPayload.self, from: data) else {
            return (fallbackTitle, "", nil)
        }
        let title = cleaned(payload.title) ?? fallbackTitle
        return (title, cleaned(payload.authorName) ?? "", payload.thumbnailURL)
    }

    private func sortTracks() {
        tracks.sort { lhs, rhs in
            let order = lhs.title.localizedStandardCompare(rhs.title)
            if order == .orderedSame {
                return lhs.createdAt < rhs.createdAt
            }
            return order == .orderedAscending
        }
    }

    private func save() throws {
        let data = try encoder.encode(tracks)
        try data.write(to: libraryFileURL, options: .atomic)
    }

    private func cleaned(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}

private struct OEmbedPayload: Decodable {
    let title: String
    let authorName: String?
    let thumbnailURL: String?

    enum CodingKeys: String, CodingKey {
        case title
        case authorName = "author_name"
        case thumbnailURL = "thumbnail_url"
    }
}
