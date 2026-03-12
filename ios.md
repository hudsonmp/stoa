# Stoa iOS Native App Specification (Deferred)

## Overview
Native iOS app for Stoa using SwiftUI, targeting iOS 17+. Provides a first-class mobile reading, highlighting, and knowledge management experience that a PWA cannot match.

## Architecture
- **UI**: SwiftUI + Navigation stack
- **Data**: Supabase Swift SDK + local SQLite (Grdb.swift) for offline
- **PDF**: PDFKit + PencilKit for Apple Pencil annotations
- **Network**: URLSession + Combine for reactive data flow
- **Auth**: Supabase Auth (magic link / Apple Sign-In)

## Key Screens

### Library (Tab 1)
- Horizontal scrolling 3D bookshelf (SceneKit or custom SwiftUI transforms matching web version)
- Below: segmented control for All / Blogs / Papers / Podcasts
- Pull-to-refresh, infinite scroll
- Search bar with hybrid search via API

### People (Tab 2)
- Grid of people cards (LazyVGrid)
- Tap -> person detail: avatar, bio, their items, connections
- Long-press -> quick actions (open website, copy Twitter)
- "Add Person" sheet (name, affiliation, role, photo from contacts/camera)

### Reader (Push from item tap)
- Clean reader view (extracted text, custom typography)
- Text selection -> floating toolbar (highlight colors + note)
- Highlights sidebar (sheet)
- PDF viewer using PDFKit for papers
- Apple Pencil support on PDFs via PencilKit overlay
- Scroll position auto-saved to Supabase

### Capture (Tab 3 / Share Extension)
- Share Extension: intercept URLs from Safari, Twitter, etc.
- Quick-save with type picker and tag autocomplete
- Camera capture for physical book pages -> OCR (Vision framework)
- arXiv ID quick-add

### Review (Tab 4)
- Spaced repetition card interface (swipe-based)
- Swipe left = forgot, swipe up = hard, swipe right = good, swipe far right = easy
- Haptic feedback on responses
- Daily notification for due reviews (UNUserNotificationCenter)

### Social (Tab 5)
- Activity feed from followed users
- Profile view
- Follow/unfollow

## Offline Support
- SQLite mirror of items, people, highlights, notes (GRDB.swift)
- Background sync when connectivity returns (BGTaskScheduler)
- PDF caching in app Documents directory
- Offline highlight creation with sync queue

## Share Extension
- Minimal UI: title preview, type picker, 2 tag slots
- Background upload to /ingest endpoint
- Appears in iOS share sheet for any URL

## Widget (WidgetKit)
- Small: next review count
- Medium: recent saves + review count
- Large: mini bookshelf of recently added books

## Notifications
- "N highlights due for review" (daily at configured time)
- "X saved a new article" (social, opt-in)

## Technical Notes
- Minimum deployment: iOS 17.0
- Xcode 16+
- Swift 6 with strict concurrency
- Use @Observable macro (iOS 17 Observation framework)
- SPM packages: supabase-swift, GRDB.swift
- No third-party UI libraries needed (SwiftUI is sufficient)

## Data Flow
```
Share Extension / App
    |
    v
Local SQLite (immediate write)
    |
    v  (background)
Supabase API (via FastAPI /ingest)
    |
    v
pgvector embeddings (server-side)
```

## Build Phases
1. Core shell: auth + library + reader
2. Highlighting + notes
3. Share Extension + offline
4. Spaced repetition
5. Social feed
6. Widget + notifications
7. Apple Pencil PDF annotations
