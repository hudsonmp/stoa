import UIKit
import SwiftUI

/// UIKit host for the SwiftUI share view.
/// Delete the storyboard and set NSExtensionPrincipalClass in Info.plist.
class ShareViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()

        // Extract URL from extension context
        guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachments = extensionItem.attachments else {
            close()
            return
        }

        // Find the URL attachment
        for attachment in attachments {
            if attachment.hasItemConformingToTypeIdentifier("public.url") {
                attachment.loadItem(forTypeIdentifier: "public.url") { [weak self] item, _ in
                    guard let url = item as? URL else {
                        DispatchQueue.main.async { self?.close() }
                        return
                    }
                    DispatchQueue.main.async {
                        self?.showShareView(url: url)
                    }
                }
                return
            }
        }

        // No URL found
        close()
    }

    private func showShareView(url: URL) {
        let title = extensionContext?.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .compactMap { $0.attributedContentText?.string }
            .first

        let shareView = ShareView(
            url: url.absoluteString,
            title: title ?? url.host ?? "Untitled",
            onSave: { [weak self] in self?.close() },
            onCancel: { [weak self] in self?.close() }
        )

        let hostingController = UIHostingController(rootView: shareView)
        addChild(hostingController)
        view.addSubview(hostingController.view)
        hostingController.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            hostingController.view.topAnchor.constraint(equalTo: view.topAnchor),
            hostingController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hostingController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hostingController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        hostingController.didMove(toParent: self)
    }

    private func close() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
