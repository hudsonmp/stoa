//
//  ItemResolver.swift
//  Stoa
//
//  Given a local PDF URL inside the vault, resolve the Stoa `item_id` that
//  the Mac daemon assigned. We do this by scanning the per-item manifests
//  the daemon writes at `.stoa/items/<item_id>.json`, each of which contains
//  `{"item_id": "...", "title": "...", "path": "<vault-relative>.pdf"}`.
//
//  Tier 1 only: we read these manifests from the local vault. Tier 2+ can
//  add an authenticated `/project-items?path=...` fallback for vaults that
//  have never been scanned by a Mac daemon.
//

import Foundation

struct ResolvedItem {
    let itemID: String
    let title: String
    let relPath: String
}

enum ItemResolver {

    /// Scan `.stoa/items/*.json` inside `vault` for an entry whose `path`
    /// matches `relPath`. O(N) in the number of items — fine for Hudson's
    /// scale (hundreds). If we ever hit thousands, switch to an index file.
    static func resolve(vault: URL, relPath: String) -> ResolvedItem? {
        let manifestDir = FolderStore.itemsManifestDir(vault: vault)
        guard let enumerator = FileManager.default.enumerator(
            at: manifestDir,
            includingPropertiesForKeys: nil,
            options: [.skipsSubdirectoryDescendants, .skipsHiddenFiles]
        ) else { return nil }

        for case let url as URL in enumerator {
            guard url.pathExtension == "json" else { continue }
            guard let data = try? Data(contentsOf: url),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let itemID = obj["item_id"] as? String,
                  let path = obj["path"] as? String
            else { continue }
            if path == relPath {
                let title = obj["title"] as? String ?? ""
                return ResolvedItem(itemID: itemID, title: title, relPath: path)
            }
        }
        return nil
    }

    /// Convenience: resolve for a file URL that sits inside `vault`.
    static func resolve(vault: URL, fileURL: URL) -> ResolvedItem? {
        let vaultPath = vault.standardizedFileURL.path
        let filePath = fileURL.standardizedFileURL.path
        guard filePath.hasPrefix(vaultPath + "/") else { return nil }
        let rel = String(filePath.dropFirst(vaultPath.count + 1))
        return resolve(vault: vault, relPath: rel)
    }
}
