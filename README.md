# Stoa

Personal milieu curation and knowledge system. Named after the Stoa Poikile -- the painted porch in Athens where Stoic philosophers gathered.

**People and intellectual lineages are first-class entities**, not folders or tags. Content is organized around intellectual networks, everything is RAG-indexed for retrieval via Claude Code MCP.

## Architecture

```
Chrome Extension (Manifest V3)     Next.js Webapp (PWA)
         |                                |
         +---------------+---------------+
                         |
                    Supabase
               (Postgres + pgvector
                + Auth + Storage)
                         |
                    FastAPI
              (RAG, ingest, PDF)
                         |
                    MCP Server
                    (FastMCP)
```

## Stack

| Layer | Tech |
|-------|------|
| DB | Supabase (Postgres + pgvector + Storage) |
| Backend | FastAPI |
| Webapp | Next.js 15 + Tailwind + Framer Motion |
| Chrome Extension | Manifest V3, TypeScript |
| MCP | FastMCP (Python) |
| Embeddings | text-embedding-3-small (1536d) |
| Extraction | Trafilatura + PyMuPDF |

## Setup

### Webapp
```bash
cd webapp
cp .env.example .env.local  # Fill in Supabase keys
npm install
npm run dev
```

### Backend
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Fill in keys
uvicorn main:app --reload
```

### Chrome Extension
1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select the `chrome-extension/` directory
4. Set your user ID in the extension popup

### MCP Server
```bash
cd mcp-server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Add to claude config:
# claude mcp add -s user stoa -- python3 /path/to/stoa/mcp-server/server.py
```

### Database
Run the SQL migrations in `supabase/migrations/` against your Supabase project.

### Seed Data
```bash
cd backend
STOA_USER_ID=your-user-id python3 seed.py
```

## Features

- **3D Bookshelf**: Books with spine/cover 3D CSS transforms (ported from adam-maj/adammaj.com)
- **Chrome Extension**: Save pages, highlight text, track scroll position, save tab groups
- **Milieu Graph**: People as first-class entities with intellectual lineage connections
- **Citation Manager**: arXiv/DOI import, BibTeX export, PDF storage
- **RAG Search**: Hybrid vector + full-text search with RRF fusion
- **Spaced Repetition**: Highlight review queue using half-power law scheduling
- **Social Layer**: Follow users, activity feed, public profiles
- **MCP Server**: Full Claude Code integration for querying the knowledge base

## iOS (Deferred)
See `ios.md` for the full native iOS app spec (SwiftUI + PDFKit + PencilKit + Share Extension + offline).
