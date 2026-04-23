//
//  InkRasterizerTests.swift
//  StoaTests
//
//  Tier 1 iPad-ink rasterizer coverage.
//

import XCTest
import PencilKit
@testable import Stoa

final class InkRasterizerTests: XCTestCase {

    func testPageBasenameZeroPadding() {
        XCTAssertEqual(FolderStore.pageBasename(pageIndex: 0), "p001")
        XCTAssertEqual(FolderStore.pageBasename(pageIndex: 9), "p010")
        XCTAssertEqual(FolderStore.pageBasename(pageIndex: 99), "p100")
    }

    func testPngURLShape() {
        let vault = URL(fileURLWithPath: "/tmp/stoa-test-vault")
        let url = FolderStore.pngURL(vault: vault, itemID: "abc", pageIndex: 2)
        XCTAssertTrue(url.path.hasSuffix(".stoa/ink/abc/p003.png"))
    }

    func testRasterizeAndWriteProducesTriple() throws {
        // Skip if PencilKit can't produce an image in the test host (simulator
        // CI should be fine; failsafe for headless runners).
        let vault = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("stoa-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: vault) }
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)

        let drawing = PKDrawing()    // empty drawing is fine for determinism
        let cropRect = CGRect(x: 0, y: 0, width: 612, height: 792)  // US Letter
        let payload = InkRasterizerPayload(
            itemID: "item-xyz",
            pageIndex: 0,
            cropRect: cropRect,
            drawing: drawing,
            vaultURL: vault
        )

        let scaleUsed = InkRasterizer.rasterizeAndWrite(payload)
        XCTAssertNotNil(scaleUsed, "rasterize should succeed for empty drawing")

        let pkd = FolderStore.pkdURL(vault: vault, itemID: "item-xyz", pageIndex: 0)
        let png = FolderStore.pngURL(vault: vault, itemID: "item-xyz", pageIndex: 0)
        let meta = FolderStore.metaURL(vault: vault, itemID: "item-xyz", pageIndex: 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: pkd.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: png.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: meta.path))

        let metaJson = try JSONSerialization.jsonObject(
            with: Data(contentsOf: meta)) as? [String: Any]
        XCTAssertEqual(metaJson?["page_width_pt"] as? Double, 612.0)
        XCTAssertEqual(metaJson?["page_height_pt"] as? Double, 792.0)
        XCTAssertNotNil(metaJson?["sha_png"] as? String)
        XCTAssertNotNil(metaJson?["sha_pkd"] as? String)
    }

    func testSidecarRoundTrip() throws {
        let vault = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("stoa-roundtrip-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: vault) }
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)

        let drawing = PKDrawing()
        let payload = InkRasterizerPayload(
            itemID: "round-trip",
            pageIndex: 4,
            cropRect: CGRect(x: 0, y: 0, width: 595, height: 842),  // A4
            drawing: drawing,
            vaultURL: vault
        )
        _ = InkRasterizer.rasterizeAndWrite(payload)

        let pkd = FolderStore.pkdURL(vault: vault, itemID: "round-trip", pageIndex: 4)
        let data = try Data(contentsOf: pkd)
        // Semantic round-trip: PKDrawing initializes without error and
        // preserves the stroke count. Byte-identity is not guaranteed across
        // PencilKit's internal serialization timestamps; the test asserts the
        // observable property, not the serialized bytes.
        let loaded = try PKDrawing(data: data)
        XCTAssertEqual(loaded.strokes.count, drawing.strokes.count,
                       "PKDrawing stroke count should round-trip through .pkd")
    }
}
