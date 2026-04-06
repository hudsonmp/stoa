import SwiftUI

struct FriendsView: View {
    @Environment(StoaAPI.self) private var api

    @State private var query = ""
    @State private var searchResults: [Profile] = []
    @State private var friends: [Profile] = []
    @State private var incoming: [PendingRequest] = []
    @State private var outgoing: [PendingRequest] = []
    @State private var feed: [FeedItem] = []
    @State private var loading = true
    @State private var searching = false
    @State private var searchTask: Task<Void, Never>?
    @State private var myProfile: Profile?
    @State private var editingProfile = false
    @State private var editDisplayName = ""
    @State private var editBio = ""
    @State private var editSaving = false

    private var friendIds: Set<String> { Set(friends.map(\.userId)) }
    private var outgoingIds: Set<String> { Set(outgoing.map(\.userId)) }
    private var incomingIds: Set<String> { Set(incoming.map(\.userId)) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    profileCard
                    searchSection
                    if !incoming.isEmpty { incomingSection }
                    feedSection
                    friendsSection
                    if !outgoing.isEmpty { outgoingSection }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .navigationTitle("Friends")
            .navigationBarTitleDisplayMode(.large)
            .task { await loadAll() }
            .refreshable { await loadAll() }
        }
    }

    // MARK: - Profile card

    private var profileCard: some View {
        Group {
            if let p = myProfile {
                VStack(alignment: .leading, spacing: 10) {
                    if !editingProfile {
                        HStack(spacing: 12) {
                            AvatarCircle(profile: p, size: 48)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.displayName ?? p.username)
                                    .font(.system(.body, weight: .medium, design: .serif))
                                Text("@\(p.username)")
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                if let bio = p.bio, !bio.isEmpty {
                                    Text(bio)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                            }
                            Spacer()
                            Button("Edit") {
                                editDisplayName = p.displayName ?? ""
                                editBio = p.bio ?? ""
                                editingProfile = true
                            }
                            .font(.caption)
                            .buttonStyle(.bordered)
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("@\(p.username)")
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.tertiary)
                            TextField("Display name", text: $editDisplayName)
                                .textFieldStyle(.roundedBorder)
                            TextField("Bio", text: $editBio, axis: .vertical)
                                .textFieldStyle(.roundedBorder)
                                .lineLimit(2...4)
                            HStack {
                                Button(editSaving ? "Saving…" : "Save") {
                                    Task { await saveProfile() }
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(editSaving)
                                Button("Cancel") { editingProfile = false }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                }
                .padding(12)
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    // MARK: - Search

    private var searchSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Find people by name or @username", text: $query)
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onChange(of: query) { _, newValue in scheduleSearch(newValue) }
            }
            .padding(10)
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 10))

            if query.trimmingCharacters(in: .whitespaces).count >= 2 {
                if searching {
                    Text("Searching…").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 4)
                } else if searchResults.isEmpty {
                    Text("No matches").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 4)
                } else {
                    VStack(spacing: 0) {
                        ForEach(searchResults) { p in
                            HStack(spacing: 12) {
                                NavigationLink(destination: ProfileDetailView(username: p.username)) {
                                    HStack(spacing: 10) {
                                        AvatarCircle(profile: p, size: 34)
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(p.displayName ?? p.username).font(.subheadline)
                                            Text("@\(p.username)").font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                    }
                                }
                                .buttonStyle(.plain)
                                searchActionButton(for: p)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            if p.userId != searchResults.last?.userId { Divider() }
                        }
                    }
                    .background(Color(.systemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(.separator), lineWidth: 0.5))
                }
            }
        }
    }

    @ViewBuilder
    private func searchActionButton(for p: Profile) -> some View {
        if friendIds.contains(p.userId) {
            Label("Friends", systemImage: "checkmark").font(.caption2).labelStyle(.titleOnly)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(Color(.systemGray5)).clipShape(Capsule())
        } else if outgoingIds.contains(p.userId) {
            Label("Sent", systemImage: "clock").font(.caption2).labelStyle(.titleOnly)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(Color(.systemGray5)).clipShape(Capsule())
        } else if incomingIds.contains(p.userId) {
            Button { Task { await handleAcceptFromSearch(p) } } label: {
                Label("Accept", systemImage: "checkmark").font(.caption2).labelStyle(.titleOnly)
            }.buttonStyle(.borderedProminent).controlSize(.mini)
        } else {
            Button { Task { await handleSendRequest(p) } } label: {
                Label("Add", systemImage: "person.badge.plus").font(.caption2).labelStyle(.titleOnly)
            }.buttonStyle(.borderedProminent).controlSize(.mini)
        }
    }

    // MARK: - Incoming

    private var incomingSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("Friend Requests", count: incoming.count)
            ForEach(incoming) { req in
                HStack(spacing: 10) {
                    NavigationLink(destination: ProfileDetailView(username: req.username)) {
                        HStack(spacing: 10) {
                            AvatarCircle(profile: req.asProfile, size: 36)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(req.displayName ?? req.username).font(.subheadline.weight(.medium))
                                Text("@\(req.username)").font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                    }.buttonStyle(.plain)
                    Button { Task { await handleAccept(req) } } label: {
                        Image(systemName: "checkmark")
                    }.buttonStyle(.borderedProminent).controlSize(.small)
                    Button { Task { await handleRemove(req.username, req.userId) } } label: {
                        Image(systemName: "xmark")
                    }.buttonStyle(.bordered).controlSize(.small)
                }
                .padding(10)
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    // MARK: - Feed

    private var feedSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("Feed", count: feed.count)
            if loading {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 16)
            } else if feed.isEmpty {
                Text(friends.isEmpty ? "Add friends to see what they're reading" : "Your friends haven't saved anything yet")
                    .font(.system(.callout, design: .serif)).foregroundStyle(.secondary)
            } else {
                ForEach(feed) { row in
                    HStack(alignment: .top, spacing: 10) {
                        AvatarCircle(profile: Profile(userId: row.userId, username: row.username, displayName: row.displayName, bio: nil, avatarUrl: row.avatarUrl, createdAt: nil), size: 30)
                        VStack(alignment: .leading, spacing: 2) {
                            (Text(row.displayName ?? row.username).bold() + Text(" \(row.verb) ").foregroundColor(.secondary) + Text(row.itemTitle ?? "untitled").italic())
                                .font(.subheadline).lineLimit(2)
                            if let d = row.itemDomain {
                                Text(d).font(.system(.caption2, design: .monospaced)).foregroundStyle(.tertiary)
                            }
                        }
                        Spacer()
                    }
                    .padding(10)
                    .background(Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }

    // MARK: - Friends grid

    private var friendsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("Friends", count: friends.count)
            if !loading && friends.isEmpty {
                Text("No friends yet — search above to send your first request")
                    .font(.system(.callout, design: .serif)).foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
                    ForEach(friends) { p in
                        NavigationLink(destination: ProfileDetailView(username: p.username)) {
                            HStack(spacing: 10) {
                                AvatarCircle(profile: p, size: 34)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(p.displayName ?? p.username).font(.subheadline.weight(.medium)).foregroundStyle(.primary).lineLimit(1)
                                    Text("@\(p.username)").font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer()
                            }
                            .padding(10)
                            .background(Color(.secondarySystemBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Outgoing

    private var outgoingSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("Pending", count: outgoing.count)
            ForEach(outgoing) { req in
                HStack(spacing: 10) {
                    AvatarCircle(profile: req.asProfile, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(req.displayName ?? req.username).font(.subheadline)
                        Text("@\(req.username) · waiting").font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { Task { await handleRemove(req.username, req.userId) } } label: {
                        Label("Withdraw", systemImage: "person.badge.minus").font(.caption2).labelStyle(.titleOnly)
                    }.buttonStyle(.bordered).controlSize(.mini)
                }
                .padding(10)
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String, count: Int) -> some View {
        HStack {
            Text(title.uppercased()).font(.system(.caption2, weight: .semibold, design: .monospaced)).foregroundStyle(.tertiary).tracking(1.5)
            Rectangle().fill(Color(.separator)).frame(height: 0.5)
            Text("\(count)").font(.system(.caption2, design: .monospaced)).foregroundStyle(.tertiary).monospacedDigit()
        }
    }

    // MARK: - Network

    private func loadAll() async {
        loading = true
        async let profileCall = try? await api.getMyProfile()
        async let friendsCall = (try? await api.listFriends()) ?? []
        async let incomingCall = (try? await api.listIncomingRequests()) ?? []
        async let outgoingCall = (try? await api.listOutgoingRequests()) ?? []
        async let feedCall = (try? await api.getFeed()) ?? []
        let (profResult, fr, inc, out, fe) = await (profileCall, friendsCall, incomingCall, outgoingCall, feedCall)
        if let (p, _) = profResult { myProfile = p }
        friends = fr; incoming = inc; outgoing = out; feed = fe
        loading = false
    }

    private func scheduleSearch(_ newValue: String) {
        searchTask?.cancel()
        let trimmed = newValue.trimmingCharacters(in: .whitespaces)
        if trimmed.count < 2 { searchResults = []; return }
        searching = true
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 80_000_000)
            if Task.isCancelled { return }
            let results = (try? await api.searchUsers(trimmed)) ?? []
            if Task.isCancelled { return }
            await MainActor.run { searchResults = results; searching = false }
        }
    }

    private func saveProfile() async {
        editSaving = true
        defer { editSaving = false }
        if let updated = try? await api.updateMyProfile(displayName: editDisplayName.isEmpty ? nil : editDisplayName, bio: editBio.isEmpty ? nil : editBio) {
            myProfile = updated
            editingProfile = false
        }
    }

    private func handleSendRequest(_ target: Profile) async {
        outgoing.insert(PendingRequest(userId: target.userId, username: target.username, displayName: target.displayName, avatarUrl: target.avatarUrl, bio: target.bio, requestedAt: nil), at: 0)
        if let state = try? await api.sendFriendRequest(username: target.username), state == "accepted" {
            outgoing.removeAll { $0.userId == target.userId }
            incoming.removeAll { $0.userId == target.userId }
            friends.insert(target, at: 0)
            await loadAll()
        }
    }

    private func handleAcceptFromSearch(_ p: Profile) async {
        incoming.removeAll { $0.userId == p.userId }
        friends.insert(p, at: 0)
        try? await api.acceptFriendRequest(username: p.username)
        await loadAll()
    }

    private func handleAccept(_ req: PendingRequest) async {
        incoming.removeAll { $0.userId == req.userId }
        friends.insert(req.asProfile, at: 0)
        try? await api.acceptFriendRequest(username: req.username)
        await loadAll()
    }

    private func handleRemove(_ username: String, _ userId: String) async {
        friends.removeAll { $0.userId == userId }
        incoming.removeAll { $0.userId == userId }
        outgoing.removeAll { $0.userId == userId }
        try? await api.removeFriend(username: username)
    }
}

struct AvatarCircle: View {
    let profile: Profile
    let size: CGFloat

    var body: some View {
        Group {
            if let urlString = profile.avatarUrl, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    if case .success(let img) = phase { img.resizable().scaledToFill() } else { placeholder }
                }
            } else { placeholder }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var placeholder: some View {
        ZStack {
            Circle().fill(Color(.systemGray5))
            Text(profile.initial).font(.system(size: size * 0.42, weight: .semibold, design: .serif)).foregroundStyle(.secondary)
        }
    }
}
