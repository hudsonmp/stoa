//
//  InkRasterizer.swift
//  Stoa
//
//  Converts a PKDrawing into the three-file sidecar unit the Mac daemon +
//  webapp expect:  .pkd (vector)  +  .png (raster overlay)  +  .meta.json.
//
//  Design constraints (from the plan, flagged as real risks):
//    1. Never block stroke input. All rasterization runs inside a detached
//       `Task(priority: .userInitiated)` kicked off from the PKCanvasViewDelegate.
//    2. Debounce 800ms from the last `drawingDidChange` so a continuous
//       stroke doesn't fire N rasters. A single `DebouncedWriter` coalesces
//       bursts.
//    3. Cap PNG size at 2MB per page. If the first-pass (scale=2x) overshoots,
//       re-try at 1.5x. Below that we accept the file — degraded fidelity is
//       preferable to dropping the page entirely.
//    4. Page rect == PDF cropBox (in PDF points). The rasterizer writes
//       page_width_pt / page_height_pt into meta.json so the webapp can
//       render the PNG with the correct aspect ratio without re-parsing
//       the PDF.
//

import Foundation
import PencilKit
import UIKit
import CommonCrypto

struct InkRasterizerPayload {
    let itemID: String
    let pageIndex: Int
    let cropRect: CGRect        // in PDF points
    let drawing: PKDrawing
    let vaultURL: URL
}

enum InkRasterizer {

    static let pkVersion = 1
    static let maxPngBytes = 2 * 1024 * 1024
    static let primaryScale: CGFloat = 2.0
    static let fallbackScale: CGFloat = 1.5

    /// Synchronous rasterize + write. Caller is expected to wrap this in
    /// `Task.detached(priority: .userInitiated)`.
    ///
    /// Returns the scale that was actually used on disk (2.0 or 1.5), or nil
    /// on complete failure.
    @discardableResult
    static func rasterizeAndWrite(_ payload: InkRasterizerPayload) -> CGFloat? {
        let pkdData = payload.drawing.dataRepresentation()
        let shaPkd = sha256Hex(pkdData)

        // First attempt at 2x; fall back to 1.5x if >2MB.
        var scale = primaryScale
        guard let pngFirst = rasterize(payload.drawing,
                                       cropRect: payload.cropRect,
                                       scale: scale)
        else { return nil }

        var pngData = pngFirst
        if pngData.count > maxPngBytes {
            scale = fallbackScale
            if let pngSecond = rasterize(payload.drawing,
                                         cropRect: payload.cropRect,
                                         scale: scale) {
                pngData = pngSecond
            }
        }
        let shaPng = sha256Hex(pngData)

        let pkdURL = FolderStore.pkdURL(vault: payload.vaultURL,
                                        itemID: payload.itemID,
                                        pageIndex: payload.pageIndex)
        let pngURL = FolderStore.pngURL(vault: payload.vaultURL,
                                        itemID: payload.itemID,
                                        pageIndex: payload.pageIndex)
        let metaURL = FolderStore.metaURL(vault: payload.vaultURL,
                                          itemID: payload.itemID,
                                          pageIndex: payload.pageIndex)

        let meta: [String: Any] = [
            "page_width_pt": Double(payload.cropRect.width),
            "page_height_pt": Double(payload.cropRect.height),
            "scale": Double(scale),
            "pk_version": pkVersion,
            "sha_pkd": shaPkd,
            "sha_png": shaPng,
            "updated_at": ISO8601DateFormatter().string(from: Date()),
        ]
        guard let metaData = try? JSONSerialization.data(
            withJSONObject: meta, options: [.prettyPrinted, .sortedKeys])
        else { return nil }

        // Order: write .pkd first (cheap), then .png (biggest), then meta.json
        // (consumers key on meta.json so a partial write never yields mis-
        // matched dimensions).
        guard FolderStore.coordinatedWrite(pkdData, to: pkdURL) else { return nil }
        guard FolderStore.coordinatedWrite(pngData, to: pngURL) else { return nil }
        guard FolderStore.coordinatedWrite(metaData, to: metaURL) else { return nil }
        return scale
    }

    /// Render a PKDrawing into a transparent PNG sized `cropRect.size * scale`.
    /// The canvas coordinate space is PDF points at zoom=1; passing `cropRect`
    /// as-is ensures stroke coordinates map 1:1 to PDF points.
    private static func rasterize(_ drawing: PKDrawing,
                                  cropRect: CGRect,
                                  scale: CGFloat) -> Data? {
        let img = drawing.image(from: cropRect, scale: scale)
        return img.pngData()
    }

    private static func sha256Hex(_ data: Data) -> String {
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes {
            _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &digest)
        }
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Debounced rasterize dispatcher
//
// One `DebouncedRasterizer` per (itemID, pageIndex) pair, owned by
// `PdfInkCoordinator`. Multiple `kick()` calls within 800ms are coalesced
// into a single rasterization pass; only the most-recent drawing is written.

final class DebouncedRasterizer {

    private let debounceNanos: UInt64 = 800_000_000   // 800ms
    private var task: Task<Void, Never>?
    private var pending: InkRasterizerPayload?
    private let lock = NSLock()

    func kick(_ payload: InkRasterizerPayload) {
        lock.lock()
        pending = payload
        task?.cancel()
        lock.unlock()

        let newTask = Task.detached(priority: .userInitiated) { [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: self.debounceNanos)
            if Task.isCancelled { return }
            self.lock.lock()
            let next = self.pending
            self.pending = nil
            self.lock.unlock()
            guard let payload = next else { return }
            _ = InkRasterizer.rasterizeAndWrite(payload)
        }

        lock.lock()
        task = newTask
        lock.unlock()
    }

    /// Force an immediate rasterize of any in-flight payload. Call on
    /// view-disappear to guarantee durability.
    func flush() {
        lock.lock()
        let p = pending
        pending = nil
        task?.cancel()
        task = nil
        lock.unlock()
        guard let p else { return }
        _ = InkRasterizer.rasterizeAndWrite(p)
    }
}
