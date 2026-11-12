import UIKit
import UniformTypeIdentifiers

@objc(ShareViewController)
final class ShareViewController: UIViewController {
    private let messageLabel = UILabel()
    private let doneButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        messageLabel.textColor = .white
        messageLabel.font = .preferredFont(forTextStyle: .title1)
        messageLabel.adjustsFontForContentSizeCategory = true
        messageLabel.numberOfLines = 0
        messageLabel.textAlignment = .center
        messageLabel.text = "Adding…"

        doneButton.setTitle("Done", for: .normal)
        doneButton.titleLabel?.font = .preferredFont(forTextStyle: .title2)
        doneButton.titleLabel?.adjustsFontForContentSizeCategory = true
        doneButton.setTitleColor(.black, for: .normal)
        doneButton.backgroundColor = .white
        doneButton.layer.cornerRadius = 18
        doneButton.addTarget(self, action: #selector(finish), for: .touchUpInside)
        doneButton.isHidden = true

        let stack = UIStackView(arrangedSubviews: [messageLabel, doneButton])
        stack.axis = .vertical
        stack.spacing = 24
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            doneButton.heightAnchor.constraint(equalToConstant: 80)
        ])

        capture()
    }

    private func capture() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
            show("That link could not be read.")
            return
        }
        let providers = item.attachments ?? []
        if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                let url = item as? URL
                DispatchQueue.main.async {
                    self.save(url?.absoluteString)
                }
            }
            return
        }
        if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                let text = item as? String
                DispatchQueue.main.async {
                    self.save(text)
                }
            }
            return
        }
        show("That link could not be read.")
    }

    private func save(_ text: String?) {
        guard let text, LinkParser.parse(text) != nil else {
            show("Use a YouTube or SoundCloud link.")
            return
        }
        guard let defaults = UserDefaults(suiteName: AppGroup.id) else {
            show("Open Wayne's Music and paste the link there.")
            return
        }
        defaults.set(text, forKey: AppGroup.pendingURLKey)
        defaults.synchronize()
        show("Saved. Open Wayne's Music to see it.")
        openHostApp()
    }

    private func show(_ text: String) {
        messageLabel.text = text
        doneButton.isHidden = false
    }

    @objc private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }

    private func openHostApp() {
        guard let url = URL(string: "waynesmusic://import") else { return }
        var responder: UIResponder? = self
        let selector = sel_registerName("openURL:")
        while let current = responder {
            if current.responds(to: selector) {
                current.perform(selector, with: url)
                break
            }
            responder = current.next
        }
    }
}
