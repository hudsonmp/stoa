//
//  PdfReaderViewController.swift
//  Stoa
//
//  UIKit core for the PDF + PencilKit reader. Hosts a PDFView, loads the
//  document from a file URL, and hands the PDFView to a PdfInkCoordinator
//  which manages per-page PKCanvasView overlays.
//
//  Why UIKit + UIViewControllerRepresentable rather than pure SwiftUI:
//  PencilKit + PDFKit coordination (canvas parenting to the inner scroll
//  view, reacting to zoom/scroll notifications) is not cleanly expressible
//  through SwiftUI's view-tree semantics. The core stays UIKit and the
//  SwiftUI shell only owns navigation chrome.
//

import UIKit
import PDFKit
import PencilKit

final class PdfReaderViewController: UIViewController {

    private let pdfURL: URL
    private let itemID: String
    private let vaultURL: URL

    private let pdfView = PDFView()
    private var coordinator: PdfInkCoordinator?
    private var statusLabel: UILabel?

    init(pdfURL: URL, itemID: String, vaultURL: URL) {
        self.pdfURL = pdfURL
        self.itemID = itemID
        self.vaultURL = vaultURL
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        pdfView.translatesAutoresizingMaskIntoConstraints = false
        pdfView.autoScales = true
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        pdfView.usePageViewController(false)
        view.addSubview(pdfView)

        NSLayoutConstraint.activate([
            pdfView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            pdfView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            pdfView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            pdfView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        loadDocument()
    }

    private func loadDocument() {
        // iCloud: if the PDF lives in the ubiquity container and hasn't been
        // materialized on this device yet, request a download and show a
        // spinner until it lands.
        if FolderStore.isNotDownloaded(pdfURL) {
            FolderStore.requestDownload(pdfURL)
            showStatus("Downloading from iCloud…")
            observeDownload()
            return
        }

        guard let doc = PDFDocument(url: pdfURL) else {
            showStatus("Could not open PDF")
            return
        }
        pdfView.document = doc

        // Install the ink coordinator AFTER the document is attached so
        // pdfView.documentView exists.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.coordinator = PdfInkCoordinator(
                pdfView: self.pdfView,
                itemID: self.itemID,
                vaultURL: self.vaultURL
            )
            self.coordinator?.refreshVisibleCanvases()
            self.clearStatus()
        }
    }

    // MARK: - iCloud download polling

    private func observeDownload() {
        let query = NSMetadataQuery()
        query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        query.predicate = NSPredicate(format: "%K == %@",
                                      NSMetadataItemURLKey,
                                      pdfURL as NSURL)
        NotificationCenter.default.addObserver(
            forName: .NSMetadataQueryDidUpdate,
            object: query,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            if !FolderStore.isNotDownloaded(self.pdfURL) {
                query.stop()
                self.loadDocument()
            }
        }
        query.start()
    }

    // MARK: - Status UI

    private func showStatus(_ text: String) {
        if statusLabel == nil {
            let lbl = UILabel()
            lbl.translatesAutoresizingMaskIntoConstraints = false
            lbl.textAlignment = .center
            lbl.numberOfLines = 0
            lbl.textColor = .secondaryLabel
            view.addSubview(lbl)
            NSLayoutConstraint.activate([
                lbl.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                lbl.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                lbl.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
                lbl.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
            ])
            statusLabel = lbl
        }
        statusLabel?.text = text
    }

    private func clearStatus() {
        statusLabel?.removeFromSuperview()
        statusLabel = nil
    }
}
