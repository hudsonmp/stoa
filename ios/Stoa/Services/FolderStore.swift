//
//  FolderStore.swift
//  Stoa
//
//  Resolves the iCloud Documents ubiquity container where the Mac folder-sync
//  daemon mirrors every project's vault. iPad reads and writes to the exact
//  same folder structure the Mac uses:
//
//    iCloud.com.stoa.shared/Documents/
//      <Project Name>/
//        <item slug>.pdf
//        .stoa/
//          items/<item_id>.json        ← written by Mac daemon, read by iPad
//          ink/<item_id>/p<NNN>.pkd    ← iPad writes ONLY
//          ink/<item_id>/p<NNN>.png
//          ink/<item_id>/p<NNN>.meta.json
//          annotations/<item_id>.json  ← Mac daemon writes; iPad-writable Tier 2
//
//  All writes use NSFileCoordinator to play nicely with concurrent Mac-daemon
//  activity (file coordination is how iCloud avoids last-writer-wins in
//  competing-document scenarios).
//

import Foundation

enum FolderStore {

    /// The app's iCloud container identifier. Must match the entitlement key
    /// `com.apple.developer.icloud-container-identifiers` and the Mac
    /// daemon's configured sync_path.
    static let containerID = "iCloud.com.stoa.shared"

    // MARK: - Ubiquity container

    /// The `Documents` subdirectory of the iCloud container. Returns nil if
    /// iCloud is not signed in / available; the caller must surface a UI
    /// state for that, never crash.
    static func documentsURL() -> URL? {
        guard let base = FileManager.default.url(forUbiquityContainerIdentifier: containerID)
        else { return nil }
        return base.appendingPathComponent("Documents", isDirectory: true)
    }

    /// Local URL for the vault of a given project name. The Mac daemon owns
    /// the creation of this directory; if it doesn't exist yet the iPad can
    /// still create `.stoa/ink/<item>/` inside it — the Mac will pick it up
    /// on next scan.
    static func projectVaultURL(projectName: String) -> URL? {
        documentsURL()?.appendingPathComponent(projectName, isDirectory: true)
    }

    // MARK: - Ink paths

    /// Directory for a specific item's ink: `.stoa/ink/<item_id>/`
    static func inkDir(vault: URL, itemID: String) -> URL {
        vault
            .appendingPathComponent(".stoa", isDirectory: true)
            .appendingPathComponent("ink", isDirectory: true)
            .appendingPathComponent(itemID, isDirectory: true)
    }

    /// `.stoa/ink/<item_id>/p<NNN>.pkd` — vector PKDrawing.dataRepresentation().
    static func pkdURL(vault: URL, itemID: String, pageIndex: Int) -> URL {
        inkDir(vault: vault, itemID: itemID)
            .appendingPathComponent("\(pageBasename(pageIndex: pageIndex)).pkd")
    }

    /// `.stoa/ink/<item_id>/p<NNN>.png` — rasterized transparent overlay.
    static func pngURL(vault: URL, itemID: String, pageIndex: Int) -> URL {
        inkDir(vault: vault, itemID: itemID)
            .appendingPathComponent("\(pageBasename(pageIndex: pageIndex)).png")
    }

    /// `.stoa/ink/<item_id>/p<NNN>.meta.json` — page dims + SHAs + scale.
    static func metaURL(vault: URL, itemID: String, pageIndex: Int) -> URL {
        inkDir(vault: vault, itemID: itemID)
            .appendingPathComponent("\(pageBasename(pageIndex: pageIndex)).meta.json")
    }

    /// 0-based index → zero-padded 1-based basename. pageIndex=0 → "p001".
    static func pageBasename(pageIndex: Int) -> String {
        String(format: "p%03d", pageIndex + 1)
    }

    // MARK: - Items manifest (file URL → item_id)

    /// Directory where the Mac daemon writes `<item_id>.json` so iPad can
    /// reverse-map a PDF's file URL → Stoa item_id without hitting the
    /// network.
    static func itemsManifestDir(vault: URL) -> URL {
        vault
            .appendingPathComponent(".stoa", isDirectory: true)
            .appendingPathComponent("items", isDirectory: true)
    }

    // MARK: - Coordinated writes

    /// Atomically write `data` to `url` using NSFileCoordinator so concurrent
    /// Mac-daemon reads / iCloud syncs don't observe torn files.
    /// Creates intermediate directories. Returns false on failure.
    @discardableResult
    static func coordinatedWrite(_ data: Data, to url: URL) -> Bool {
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
        } catch {
            NSLog("[FolderStore] mkdir failed for %@: %@", url.path, error.localizedDescription)
            return false
        }
        var coordError: NSError?
        var writeError: Error?
        let coordinator = NSFileCoordinator(filePresenter: nil)
        coordinator.coordinate(
            writingItemAt: url, options: .forReplacing,
            error: &coordError
        ) { newURL in
            do {
                try data.write(to: newURL, options: .atomic)
            } catch {
                writeError = error
            }
        }
        if let coordError {
            NSLog("[FolderStore] coord write err %@: %@", url.path, coordError.localizedDescription)
            return false
        }
        if let writeError {
            NSLog("[FolderStore] write err %@: %@", url.path, writeError.localizedDescription)
            return false
        }
        return true
    }

    // MARK: - iCloud offline handling

    /// True if the file at `url` is an iCloud placeholder (not yet downloaded
    /// to the device). Callers should trigger `startDownloadingUbiquitousItem`
    /// and display a spinner until `URLResourceKey.ubiquitousItemDownloadingStatusKey`
    /// transitions to `.current`.
    static func isNotDownloaded(_ url: URL) -> Bool {
        let keys: Set<URLResourceKey> = [
            .ubiquitousItemDownloadingStatusKey,
        ]
        guard let values = try? url.resourceValues(forKeys: keys),
              let status = values.ubiquitousItemDownloadingStatus
        else { return false }
        return status != .current
    }

    /// Kick off an iCloud download. No-op if already current.
    static func requestDownload(_ url: URL) {
        try? FileManager.default.startDownloadingUbiquitousItem(at: url)
    }
}
