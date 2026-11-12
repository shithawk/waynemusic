import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct AddTrackSheet: View {
    @EnvironmentObject private var library: LibraryStore
    @Environment(\.dismiss) private var dismiss

    @State private var showingPasteField = false
    @State private var link = ""
    @State private var importing = false
    @State private var working = false
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Add music")
                    .font(.largeTitle.weight(.bold))
                    .foregroundColor(.white)

                Button("From this iPad") {
                    importing = true
                }
                .buttonStyle(BigButtonStyle())

                Button("Paste the copied link") {
                    let copied = UIPasteboard.general.string ?? ""
                    guard !copied.isEmpty else {
                        errorText = "Copy a YouTube or SoundCloud link first."
                        return
                    }
                    Task { await add(copied) }
                }
                .buttonStyle(BigButtonStyle(prominent: true))
                .disabled(working)

                Button(showingPasteField ? "Hide the link box" : "Type a link") {
                    showingPasteField.toggle()
                }
                .buttonStyle(BigButtonStyle())

                if showingPasteField {
                    Text("YouTube or SoundCloud link")
                        .font(.title3.weight(.semibold))
                        .foregroundColor(.white)
                    TextField("https://", text: $link)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .keyboardType(.URL)
                        .font(.title3)
                        .foregroundColor(.white)
                        .padding(16)
                        .background(Theme.card)
                        .cornerRadius(14)
                    Button(working ? "Adding…" : "Add this link") {
                        Task { await add(link) }
                    }
                    .buttonStyle(BigButtonStyle(prominent: true))
                    .disabled(working || link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                Text("You can also tap Share in YouTube or SoundCloud, then choose Wayne's Music.")
                    .font(.title3)
                    .foregroundColor(.white.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)

                if let errorText {
                    Text(errorText)
                        .font(.title3.weight(.semibold))
                        .foregroundColor(.yellow)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button("Close") {
                    dismiss()
                }
                .buttonStyle(BigButtonStyle())
            }
            .padding(24)
        }
        .background(Theme.background.ignoresSafeArea())
        .fileImporter(
            isPresented: $importing,
            allowedContentTypes: [.mp3, .mpeg4Audio, .audio],
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls):
                Task { await importSongs(urls) }
            case .failure:
                errorText = "Those songs could not be opened."
            }
        }
    }

    private func add(_ text: String) async {
        working = true
        errorText = nil
        do {
            let title = try await library.addLink(text)
            working = false
            dismiss()
            DispatchQueue.main.async {
                library.notice = "Added \(title)"
            }
        } catch {
            working = false
            errorText = error.localizedDescription
        }
    }

    private func importSongs(_ urls: [URL]) async {
        working = true
        let message = await library.importFiles(urls)
        working = false
        dismiss()
        DispatchQueue.main.async {
            library.notice = message
        }
    }
}
