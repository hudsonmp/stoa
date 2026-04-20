//
//  PdfReaderView.swift
//  Stoa
//
//  SwiftUI shell around `PdfReaderViewController`. Owns top-bar chrome
//  (title, back) and hands off PDF rendering + ink to the UIKit core.
//

import SwiftUI
import UIKit

struct PdfReaderView: View {

    let pdfURL: URL
    let itemID: String
    let vaultURL: URL
    let title: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        PdfReaderRepresentable(
            pdfURL: pdfURL,
            itemID: itemID,
            vaultURL: vaultURL
        )
        .ignoresSafeArea(.container, edges: .bottom)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PdfReaderRepresentable: UIViewControllerRepresentable {

    let pdfURL: URL
    let itemID: String
    let vaultURL: URL

    func makeUIViewController(context: Context) -> PdfReaderViewController {
        PdfReaderViewController(
            pdfURL: pdfURL,
            itemID: itemID,
            vaultURL: vaultURL
        )
    }

    func updateUIViewController(_ uiViewController: PdfReaderViewController,
                                context: Context) {
        // No-op: the controller is identity-addressed by (pdfURL, itemID).
        // Swapping documents would require reconstructing the coordinator.
    }
}
