import AVFoundation
import Combine
import Foundation
import MediaPlayer
import UIKit

struct WebAction: Equatable {
    var token: Int
    var name: String
}

@MainActor
final class PlaybackController: ObservableObject {
    @Published var current: Track?
    @Published var isPlaying = false
    @Published var webAction = WebAction(token: 0, name: "pause")
    @Published var message: String?

    private let player = AVPlayer()
    private var tracks: [Track] = []
    private var statusObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?

    init() {
        player.allowsExternalPlayback = false
        player.usesExternalPlaybackWhileExternalScreenIsActive = false
        configureSession()
        installObservers()
        installRemoteCommands()
    }

    func updateQueue(_ tracks: [Track]) {
        self.tracks = tracks
        if let current, !tracks.contains(where: { $0.id == current.id }) {
            stop()
        }
    }

    func play(_ track: Track) {
        current = track
        message = nil
        switch track.source {
        case .local:
            sendWeb("pause")
            playLocal(track)
        case .youtube, .soundcloud:
            player.pause()
            isPlaying = true
            sendWeb("play")
            publishNowPlaying(for: track, elapsed: 0, duration: 0, rate: 1)
        }
    }

    func toggle() {
        guard let current else { return }
        if current.source == .local {
            if player.timeControlStatus == .playing {
                player.pause()
            } else {
                player.play()
            }
        } else {
            sendWeb(isPlaying ? "pause" : "play")
            isPlaying.toggle()
        }
    }

    func next() {
        move(step: 1)
    }

    func previous() {
        move(step: -1)
    }

    func trackFinished() {
        move(step: 1)
    }

    func stop() {
        player.pause()
        player.replaceCurrentItem(with: nil)
        sendWeb("pause")
        current = nil
        isPlaying = false
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    func report(_ text: String) {
        message = text
    }

    private func move(step: Int) {
        guard let current else { return }
        let upcoming = step > 0
            ? Playlist.next(after: current.id, in: tracks)
            : Playlist.previous(before: current.id, in: tracks)
        guard let upcoming else { return }
        if upcoming.id == current.id {
            restart(upcoming)
        } else {
            play(upcoming)
        }
    }

    private func restart(_ track: Track) {
        current = track
        if track.source == .local {
            player.seek(to: .zero)
            player.play()
            publishNowPlaying(for: track, elapsed: 0, duration: durationSeconds, rate: 1)
        } else {
            sendWeb("restart")
            isPlaying = true
        }
    }

    private func playLocal(_ track: Track) {
        let url = musicFileURL(named: track.mediaRef)
        guard FileManager.default.fileExists(atPath: url.path) else {
            message = "That song is missing from this iPad."
            isPlaying = false
            return
        }
        let item = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: item)
        player.play()
        isPlaying = true
        publishNowPlaying(for: track, elapsed: 0, duration: 0, rate: 1)
    }

    private func sendWeb(_ name: String) {
        webAction = WebAction(token: webAction.token + 1, name: name)
    }

    private func configureSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default)
        try? session.setActive(true)
    }

    private func installObservers() {
        statusObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            let playing = player.timeControlStatus == .playing
            Task { @MainActor in
                guard let self, self.current?.source == .local else { return }
                self.isPlaying = playing
            }
        }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let item = notification.object as? AVPlayerItem
            Task { @MainActor in
                guard let self, let item, item == self.player.currentItem, self.current?.source == .local else {
                    return
                }
                self.next()
            }
        }
    }

    private func installRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true

        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.resumeFromRemote() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pauseFromRemote() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.toggle() }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.next() }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.previous() }
            return .success
        }
    }

    private func resumeFromRemote() {
        guard current != nil else { return }
        if !isPlaying { toggle() }
    }

    private func pauseFromRemote() {
        guard current != nil else { return }
        if isPlaying { toggle() }
    }

    private var durationSeconds: Double {
        let seconds = player.currentItem?.duration.seconds ?? 0
        return seconds.isFinite ? seconds : 0
    }

    private func publishNowPlaying(for track: Track, elapsed: Double, duration: Double, rate: Double) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.subtitle,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: rate
        ]
        if duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        if track.source == .local, let artworkRef = track.artworkRef,
           let image = UIImage(contentsOfFile: musicFileURL(named: artworkRef).path) {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func musicFileURL(named filename: String) -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return appSupport
            .appendingPathComponent("WayneMusic", isDirectory: true)
            .appendingPathComponent("Music", isDirectory: true)
            .appendingPathComponent(filename)
    }
}
