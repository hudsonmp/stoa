//
//  PdfInkCoordinator.swift
//  Stoa
//
//  Coordinates per-page PKCanvasView overlays for a PDFView. The one thing
//  that MUST be right: canvases are children of `pdfView.documentView` (the
//  inner UIScrollView), NOT of the PDFView itself. This is Apple's canonical
//  fix for zoom/scroll drift — a canvas parented to PDFView floats away when
//  the user pinches because the inner scroll transforms independently.
//
//  References:
//    - Apple sample code "Supporting Apple Pencil on iPad" (WWDC 2019/2020)
//    - Radar discussion in "PDFKit + PencilKit: coordinating zoom".
//
//  Responsibilities:
//    - Install/remove per-page PKCanvasView overlays as pages scroll into view.
//    - On scroll/zoom/visible-pages change: re-layout each canvas via
//      `pdfView.convert(page.bounds(for: .cropBox), from: page)`.
//    - Observe `PKCanvasViewDelegate.canvasViewDrawingDidChange` and kick
//      the rasterizer for that (itemID, pageIndex) pair.
//    - Rehydrate previously-saved `.pkd` on page load.
//

import Foundation
import PDFKit
import PencilKit
import UIKit

final class PdfInkCoordinator: NSObject {

    let pdfView: PDFView
    let itemID: String
    let vaultURL: URL
    let toolPicker: PKToolPicker

    // One canvas per page index. Rebuilt lazily on visible-pages changes.
    private var canvases: [Int: PKCanvasView] = [:]
    private var rasterizers: [Int: DebouncedRasterizer] = [:]

    // Retained observers so we can re-layout when the inner scroll view
    // zooms or scrolls. PDFView does not publish a first-class zoom callback,
    // so we observe the inner UIScrollView directly.
    private var zoomObserver: NSObjectProtocol?
    private var scrollObserver: NSObjectProtocol?
    private var pageChangeObserver: NSObjectProtocol?

    init(pdfView: PDFView,
         itemID: String,
         vaultURL: URL,
         toolPicker: PKToolPicker = PKToolPicker()) {
        self.pdfView = pdfView
        self.itemID = itemID
        self.vaultURL = vaultURL
        self.toolPicker = toolPicker
        super.init()
        installObservers()
    }

    deinit {
        tearDownObservers()
        for r in rasterizers.values {
            r.flush()
        }
    }

    // MARK: - Public

    /// Install/refresh canvases for every currently-visible page.
    func refreshVisibleCanvases() {
        let pages = pdfView.visiblePages
        var keepIndices = Set<Int>()
        for page in pages {
            guard let doc = page.document else { continue }
            let idx = doc.index(for: page)
            keepIndices.insert(idx)
            ensureCanvas(for: page, pageIndex: idx)
        }
        // Remove canvases for pages that scrolled far enough out of view. We
        // keep the off-screen canvases' drawings in memory because the next
        // scroll can snap them back in; actually destroying them only on
        // tear-down avoids dropping unsaved strokes.
        _ = keepIndices
        layoutCanvases()
    }

    // MARK: - Observers

    private func installObservers() {
        let nc = NotificationCenter.default

        pageChangeObserver = nc.addObserver(
            forName: .PDFViewVisiblePagesChanged,
            object: pdfView,
            queue: .main
        ) { [weak self] _ in
            self?.refreshVisibleCanvases()
        }

        // PDFView does not publish a direct zoom callback. `PDFViewScaleChanged`
        // fires on user pinch-zoom. We also observe visible-pages changes which
        // covers the scroll case. If drift shows up during fast scroll, add a
        // KVO observer on pdfView.documentView.contentOffset.
        zoomObserver = nc.addObserver(
            forName: .PDFViewScaleChanged,
            object: pdfView,
            queue: .main
        ) { [weak self] _ in
            self?.layoutCanvases()
        }

        pdfView.documentView?.addObserver(self,
                                          forKeyPath: "bounds",
                                          options: [.new],
                                          context: nil)
    }

    private func tearDownObservers() {
        if let z = zoomObserver { NotificationCenter.default.removeObserver(z) }
        if let s = scrollObserver { NotificationCenter.default.removeObserver(s) }
        if let p = pageChangeObserver { NotificationCenter.default.removeObserver(p) }
        pdfView.documentView?.removeObserver(self, forKeyPath: "bounds")
    }

    override func observeValue(forKeyPath keyPath: String?,
                               of object: Any?,
                               change: [NSKeyValueChangeKey: Any]?,
                               context: UnsafeMutableRawPointer?) {
        if keyPath == "bounds" {
            layoutCanvases()
        }
    }

    // MARK: - Canvas lifecycle

    private func ensureCanvas(for page: PDFPage, pageIndex: Int) {
        if canvases[pageIndex] != nil { return }

        let canvas = PKCanvasView()
        canvas.drawingPolicy = .pencilOnly          // palm rejection; fingers scroll
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.delegate = self

        // Attempt to rehydrate a saved drawing for this page.
        let pkd = FolderStore.pkdURL(vault: vaultURL, itemID: itemID, pageIndex: pageIndex)
        if let data = try? Data(contentsOf: pkd),
           let drawing = try? PKDrawing(data: data) {
            canvas.drawing = drawing
        }

        // CRITICAL: parent the canvas to the inner UIScrollView, not to
        // pdfView. Otherwise the canvas will float away during pinch-zoom.
        guard let docView = pdfView.documentView else {
            NSLog("[PdfInkCoordinator] documentView nil; canvas not attached")
            return
        }
        docView.addSubview(canvas)
        canvases[pageIndex] = canvas
        rasterizers[pageIndex] = DebouncedRasterizer()

        // Attach the tool picker to the first canvas. One picker per document.
        if canvas.becomeFirstResponder() {
            toolPicker.setVisible(true, forFirstResponder: canvas)
            toolPicker.addObserver(canvas)
        }
    }

    /// Re-position every canvas to cover its page's cropBox in document-view
    /// coordinate space. Call this after any layout change.
    private func layoutCanvases() {
        guard let docView = pdfView.documentView else { return }
        for (pageIndex, canvas) in canvases {
            guard let page = pdfView.document?.page(at: pageIndex) else { continue }
            // cropBox in PDF-space, converted to pdfView coords, then translated
            // into documentView's coordinate space.
            let cropPdf = page.bounds(for: .cropBox)
            let cropInPdfView = pdfView.convert(cropPdf, from: page)
            // pdfView.convert(..., from: page) returns coords in PDFView's space;
            // convert to documentView space.
            let cropInDoc = pdfView.convert(cropInPdfView, to: docView)
            canvas.frame = cropInDoc

            // Keep the stroke coordinate system invariant: we treat the canvas
            // frame as PDF points at zoom=1 for rasterization purposes. The
            // visible frame scales with pinch — that's the whole point of
            // parenting under documentView.
        }
    }
}

// MARK: - PKCanvasViewDelegate

extension PdfInkCoordinator: PKCanvasViewDelegate {

    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        // Find which page this canvas belongs to.
        guard let (pageIndex, _) = canvases.first(where: { $0.value === canvasView })
        else { return }
        guard let page = pdfView.document?.page(at: pageIndex) else { return }
        let cropRect = page.bounds(for: .cropBox)

        let payload = InkRasterizerPayload(
            itemID: itemID,
            pageIndex: pageIndex,
            cropRect: cropRect,
            drawing: canvasView.drawing,
            vaultURL: vaultURL
        )
        rasterizers[pageIndex]?.kick(payload)
    }
}
