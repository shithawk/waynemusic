import XCTest
@testable import WayneMusic

final class LinkParserTests: XCTestCase {
    func testYouTubeWatchURL() {
        let parsed = LinkParser.parse("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        XCTAssertEqual(parsed, .youtube(id: "dQw4w9WgXcQ", pageURL: URL(string: "https://www.youtube.com/watch?v=dQw4w9WgXcQ")!))
    }

    func testYouTubeShortLinkAndExtraWords() {
        let parsed = LinkParser.parse("listen https://youtu.be/dQw4w9WgXcQ?si=abc thanks")
        XCTAssertEqual(parsed, .youtube(id: "dQw4w9WgXcQ", pageURL: URL(string: "https://www.youtube.com/watch?v=dQw4w9WgXcQ")!))
    }

    func testYouTubeShortsMusicAndEmbed() {
        XCTAssertEqual(
            LinkParser.parse("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
            .youtube(id: "dQw4w9WgXcQ", pageURL: URL(string: "https://www.youtube.com/watch?v=dQw4w9WgXcQ")!)
        )
        XCTAssertEqual(
            LinkParser.parse("https://music.youtube.com/watch?v=dQw4w9WgXcQ"),
            .youtube(id: "dQw4w9WgXcQ", pageURL: URL(string: "https://www.youtube.com/watch?v=dQw4w9WgXcQ")!)
        )
        XCTAssertEqual(
            LinkParser.parse("https://www.youtube.com/embed/dQw4w9WgXcQ"),
            .youtube(id: "dQw4w9WgXcQ", pageURL: URL(string: "https://www.youtube.com/watch?v=dQw4w9WgXcQ")!)
        )
    }

    func testYouTubePlaylistWithoutVideoIsRejected() {
        XCTAssertNil(LinkParser.parse("https://www.youtube.com/playlist?list=PL1234567890"))
    }

    func testSoundCloudTrackAndShortLink() {
        let page = URL(string: "https://soundcloud.com/artist/song-name")!
        XCTAssertEqual(LinkParser.parse(page.absoluteString), .soundcloud(pageURL: page))
        let shortLink = URL(string: "https://on.soundcloud.com/abcXYZ")!
        XCTAssertEqual(LinkParser.parse(shortLink.absoluteString), .soundcloud(pageURL: shortLink))
    }

    func testSoundCloudHomeAndOtherSitesAreRejected() {
        XCTAssertNil(LinkParser.parse("https://soundcloud.com/"))
        XCTAssertNil(LinkParser.parse("https://example.com/song.mp3"))
        XCTAssertNil(LinkParser.parse("not a link"))
    }
}

final class PlaylistTests: XCTestCase {
    private func track(_ title: String) -> Track {
        Track(id: UUID(), title: title, artist: "", source: .local, mediaRef: title, artworkRef: nil, createdAt: Date())
    }

    func testNextAndPreviousFollowListOrderAndWrap() {
        let songs = [track("A"), track("B"), track("C")]
        XCTAssertEqual(Playlist.next(after: songs[0].id, in: songs)?.title, "B")
        XCTAssertEqual(Playlist.next(after: songs[2].id, in: songs)?.title, "A")
        XCTAssertEqual(Playlist.previous(before: songs[0].id, in: songs)?.title, "C")
        XCTAssertEqual(Playlist.previous(before: songs[1].id, in: songs)?.title, "A")
    }

    func testSingleSongStaysPut() {
        let songs = [track("Only")]
        XCTAssertEqual(Playlist.next(after: songs[0].id, in: songs)?.id, songs[0].id)
        XCTAssertEqual(Playlist.previous(before: songs[0].id, in: songs)?.id, songs[0].id)
    }
}

@MainActor
final class LibraryStoreTests: XCTestCase {
    func testSongsSaveAndComeBackSortedByTitle() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let store = LibraryStore(baseDirectory: directory)
        store.add(Track(id: UUID(), title: "Zebra", artist: "A", source: .local, mediaRef: "z.mp3", artworkRef: nil, createdAt: Date()))
        store.add(Track(id: UUID(), title: "Apple", artist: "B", source: .youtube, mediaRef: "abcdefghijk", artworkRef: nil, createdAt: Date()))

        let reloaded = LibraryStore(baseDirectory: directory)
        XCTAssertEqual(reloaded.tracks.map(\.title), ["Apple", "Zebra"])
        try? FileManager.default.removeItem(at: directory)
    }

    func testRemoveDeletesTheSongFromTheList() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let store = LibraryStore(baseDirectory: directory)
        let track = Track(id: UUID(), title: "Gone", artist: "", source: .youtube, mediaRef: "abcdefghijk", artworkRef: nil, createdAt: Date())
        store.add(track)
        store.remove(track)
        XCTAssertTrue(store.tracks.isEmpty)
        try? FileManager.default.removeItem(at: directory)
    }
}
