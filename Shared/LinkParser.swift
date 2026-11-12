import Foundation

enum ParsedLink: Equatable {
    case youtube(id: String, pageURL: URL)
    case soundcloud(pageURL: URL)
}

enum LinkParser {
    static func parse(_ text: String) -> ParsedLink? {
        guard let url = firstURL(in: text) else { return nil }
        if let id = youtubeID(from: url),
           let pageURL = URL(string: "https://www.youtube.com/watch?v=\(id)") {
            return .youtube(id: id, pageURL: pageURL)
        }
        if isSoundCloud(url) {
            return .soundcloud(pageURL: url)
        }
        return nil
    }

    private static func firstURL(in text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = detect(in: trimmed) { return url }
        if !trimmed.contains("://"), let url = detect(in: "https://\(trimmed)") {
            return url
        }
        return nil
    }

    private static func detect(in text: String) -> URL? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return nil
        }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = detector.firstMatch(in: text, options: [], range: range),
              let url = match.url else {
            return nil
        }
        return url
    }

    private static func youtubeID(from url: URL) -> String? {
        guard let host = url.host?.lowercased() else { return nil }
        if host == "youtu.be" || host.hasSuffix(".youtu.be") {
            let id = url.pathComponents.dropFirst().first
            return sanitizedYouTubeID(id)
        }
        guard host.contains("youtube.com") || host.contains("youtube-nocookie.com") else {
            return nil
        }
        if let videoID = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == "v" })?
            .value,
           let id = sanitizedYouTubeID(videoID) {
            return id
        }
        let parts = url.pathComponents
        let markers = ["embed", "shorts", "live", "v"]
        if let markerIndex = parts.firstIndex(where: { markers.contains($0) }),
           markerIndex + 1 < parts.count {
            return sanitizedYouTubeID(parts[markerIndex + 1])
        }
        return nil
    }

    private static func sanitizedYouTubeID(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let id = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard id.range(of: "^[A-Za-z0-9_-]{6,20}$", options: .regularExpression) != nil else {
            return nil
        }
        return id
    }

    private static func isSoundCloud(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        let isHost = host == "soundcloud.com" || host.hasSuffix(".soundcloud.com")
        guard isHost else { return false }
        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return !path.isEmpty
    }
}
