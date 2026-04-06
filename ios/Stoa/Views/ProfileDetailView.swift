import SwiftUI

struct ProfileDetailView: View {
    @Environment(StoaAPI.self) private var api
    let username: String

    @State private var profileView: ProfileView?
    @State private var items: [FriendBookshelfItem] = []
    @State private var loading = true
    @State private var error: String?
    @State private var actionBusy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                } else if let error {
                    Text(error).font(.system(.callout, design: .serif)).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.top, 40)
                } else if let pv = profileView {
                    header(pv)
                    bookshelf(pv)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .navigationTitle(profileView?.profile.displayName ?? "@\(username)")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func header(_ pv: ProfileView) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 16) {
                AvatarCircle(profile: pv.profile, size: 72)
                VStack(alignment: .leading, spacing: 3) {
                    Text(pv.profile.displayName ?? pv.profile.username)
                        .font(.system(.title2, design: .serif, weight: .semibold))
                    Text("@\(pv.profile.username)")
                        .font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
                    HStack(spacing: 4) {
                        Text("\(pv.friendCount)").font(.subheadline.weight(.semibold)).monospacedDigit()
                        Text("friends").font(.caption).foregroundStyle(.secondary)
                    }.padding(.top, 4)
                }
                Spacer()
            }
            if let bio = pv.profile.bio, !bio.isEmpty {
                Text(bio).font(.callout).foregroundStyle(.primary.opacity(0.85))
            }
            if pv.friendshipState != "self" {
                friendButton(pv)
            }
        }
    }

    private func friendButton(_ pv: ProfileView) -> some View {
        Button {
            Task { await handleAction(pv) }
        } label: {
            HStack {
                Image(systemName: buttonIcon(pv.friendshipState))
                Text(buttonLabel(pv.friendshipState)).font(.subheadline.weight(.medium))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
        }
        .buttonStyle(pv.friendshipState == "none" || pv.friendshipState == "pending_incoming" ? .borderedProminent : .bordered)
        .disabled(actionBusy)
    }

    private func buttonLabel(_ state: String) -> String {
        switch state {
        case "none": return "Add friend"
        case "pending_outgoing": return "Requested"
        case "pending_incoming": return "Accept"
        case "accepted": return "Friends"
        default: return ""
        }
    }

    private func buttonIcon(_ state: String) -> String {
        switch state {
        case "none": return "person.badge.plus"
        case "pending_outgoing": return "clock"
        case "pending_incoming": return "checkmark"
        case "accepted": return "person.badge.minus"
        default: return "person"
        }
    }

    @ViewBuilder
    private func bookshelf(_ pv: ProfileView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("SHELF").font(.system(.caption2, design: .monospaced, weight: .semibold)).foregroundStyle(.tertiary).tracking(1.5)
                Rectangle().fill(Color(.separator)).frame(height: 0.5)
                if pv.friendshipState == "accepted" || pv.friendshipState == "self" {
                    Text("\(items.count)").font(.system(.caption2, design: .monospaced)).foregroundStyle(.tertiary)
                }
            }

            if pv.friendshipState != "accepted" && pv.friendshipState != "self" {
                Text(pv.friendshipState == "pending_outgoing" ? "Request pending — their shelf will appear once accepted"
                     : pv.friendshipState == "pending_incoming" ? "Accept their request to see their shelf"
                     : "Send a friend request to see their shelf")
                    .font(.system(.callout, design: .serif)).foregroundStyle(.secondary)
            } else if items.isEmpty {
                Text("Nothing saved yet").font(.system(.callout, design: .serif)).foregroundStyle(.secondary)
            } else {
                LazyVStack(spacing: 8) {
                    ForEach(items) { item in
                        shelfRow(item)
                    }
                }
            }
        }
    }

    private func shelfRow(_ item: FriendBookshelfItem) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: typeIcon(item.type)).font(.system(size: 13)).foregroundStyle(.secondary).frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.type.uppercased()).font(.system(size: 9, design: .monospaced, weight: .semibold)).foregroundStyle(.tertiary).tracking(1)
                Text(item.title).font(.system(.body, design: .serif)).lineLimit(2)
                if let d = item.domain { Text(d).font(.system(.caption2, design: .monospaced)).foregroundStyle(.tertiary) }
            }
            Spacer()
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .contentShape(Rectangle())
        .onTapGesture {
            if let u = item.url, let url = URL(string: u) { UIApplication.shared.open(url) }
        }
    }

    private func typeIcon(_ type: String) -> String {
        switch type {
        case "paper": return "doc.text"
        case "book": return "book"
        case "blog": return "doc.richtext"
        case "video": return "play.rectangle"
        case "podcast": return "headphones"
        default: return "bookmark"
        }
    }

    // MARK: - Network

    private func load() async {
        loading = true; error = nil
        do {
            let pv = try await api.getProfile(username: username)
            profileView = pv
            if pv.friendshipState == "accepted" || pv.friendshipState == "self" {
                items = (try? await api.getProfileItems(username: username)) ?? []
            }
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func handleAction(_ pv: ProfileView) async {
        actionBusy = true
        defer { actionBusy = false }
        do {
            switch pv.friendshipState {
            case "none":
                let state = try await api.sendFriendRequest(username: username)
                profileView = ProfileView(profile: pv.profile, friendCount: pv.friendCount, friendshipState: state)
                if state == "accepted" { await load() }
            case "pending_incoming":
                try await api.acceptFriendRequest(username: username)
                profileView = ProfileView(profile: pv.profile, friendCount: pv.friendCount + 1, friendshipState: "accepted")
                await load()
            case "pending_outgoing", "accepted":
                try await api.removeFriend(username: username)
                profileView = ProfileView(profile: pv.profile, friendCount: max(0, pv.friendCount - 1), friendshipState: "none")
                items = []
            default: break
            }
        } catch { /* silent — user can retry */ }
    }
}
