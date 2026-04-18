# MCP Retrieval & Context Engineering — Research Brief

Scope: the retrieval + cacheable-context primitives shipped in `feat/mcp-retrieval`. This note states the empirical basis for each design choice so a later reviewer can contest it on the evidence, not the ergonomics.

---

## 1. State of the art for research-agent context engineering

Three threads converge on the current design space.

**Retrieval-augmented generation (RAG).** Lewis et al. (2020) framed RAG as a two-stage retrieve-then-generate problem; every subsequent "agentic" RAG variant (e.g. FAIR-RAG, Aghajani Asl et al. 2025; FLARE, Jiang et al. 2023) adds an *iteration loop* that decomposes a query, audits retrieved evidence for gaps, and re-queries until a completeness criterion trips. For literature review specifically, automated systematic review pipelines (Ali et al. 2024, arXiv 2411.18583) show that a well-tuned RAG pipeline with GPT-3.5-turbo as the synthesizer achieves higher ROUGE-1 than either extractive (spaCy) or end-to-end transformer approaches — but none of these papers actually *evaluate* retrieval quality against the agentic research workflow that a graduate student performs. The retrieval cost of wrong passages is an unrecovered token bill plus compounding error in downstream synthesis (Wampler et al. 2025, arXiv 2601.05264, on trust and fragmentation in modern RAG stacks).

**Long-context as substitute.** RULER (Hsieh et al. 2024, arXiv 2404.06654) and 100-LongBench (Yang et al. 2025, arXiv 2505.19293) show that "claimed" context lengths of 200K–2M tokens degrade sharply: only ~half of models with 32K claims maintain satisfactory performance even at 32K, and multi-hop / aggregation tasks fall first. LongBench v2 (Bai et al. 2024, arXiv 2412.15204) has even frontier long-context models near human baseline only with reasoning-time compute. Bottom line: dumping a 500K-token corpus into Claude's 1M context window is *not* free; effective context length is typically shorter than advertised, and multi-section synthesis remains open (Mortezaagha & Rahgozar 2026, arXiv 2603.22633).

**Hybrid structured-summary architectures.** Anthropic's own RAG + tool use docs and MemGPT (Packer et al. 2023, arXiv 2310.08560) converge on "hierarchical memory" — a small, always-resident summary + on-demand retrieval for depth. HiMem (Zhang et al. 2026, arXiv 2601.06377) adds topic-aware segmentation + note memory that bridges episodic events and stable knowledge. The emerging consensus: the *system prompt* should carry a compact, cache-friendly project summary (what we ship as `get_project_context`); the *tool calls* should handle depth on demand (`rag_over_project`, `search_project_notes`, `extract_references`).

---

## 2. Trade-offs: embed-and-retrieve vs. long-context-all-in vs. hybrid

| Dimension | Embed + retrieve | Long-context dump | Hybrid (our pick) |
|---|---|---|---|
| Token cost per query | O(k retrieved chunks) | O(entire corpus) | O(summary + k chunks) |
| Time to first token | Low; parallel embed | High; huge prefill | Low after cache hit |
| Multi-hop reasoning | Weak without iteration | Strong within reasoning budget | Strong if cached summary keeps cross-section cues |
| Section-diversity (GraLC-RAG finding) | Poor without structure-aware retrieval | Free | Poor unless retrieval is structure-aware |
| Cache hit rate for re-querying same project | N/A (each query re-embeds, retrieval fetches anew) | ~0 (context changes) | High (summary is stable) |

**When each wins for literature review specifically.**

- Long-context all-in wins when the corpus is ≤ 50K tokens *and* the agent's reasoning budget is large. Below that threshold, prefill dominates and retrieval overhead isn't worth the latency.
- Pure embed-and-retrieve wins when the corpus is large and the agent's queries are narrow (single-paper citations, exact-quote lookup). It loses on cross-paper synthesis because no single retrieval step ever sees the "shape" of the project.
- Hybrid wins the overlap: a cached summary (folder tree, one-line abstracts, evergreen notes) grounds the agent in project shape; retrieval fills in exact passages on demand. This is the shape of `get_project_context` + `rag_over_project`.

The chief open question: *when does the agent need which?* FAIR-RAG-style iterative gap analysis suggests the agent itself should decide, not the infrastructure. That's why `get_project_context` returns a blob *without* a system-prompt template — we let the calling agent bring its own strategy.

---

## 3. Chunking strategy for PDFs with mixed content

Our current `services/embedding.chunk_text` is sentence-boundary splitting with `chunk_size = 512 words, overlap = 64`. Three plausible upgrades, ranked by expected lift:

1. **Late chunking** (Günther et al. 2024, arXiv 2409.04701). Embed the *full document* with a long-context embedder, then chunk *after* mean pooling. This preserves contextual information that sentence-level chunks lose. Merola & Singh (2025, arXiv 2504.19754) found late chunking more efficient but less semantically complete than contextual retrieval; reasonable trade-off for a personal KB where we index overnight.
2. **Proposition-based units** (Chen et al. 2023, Dense X Retrieval, arXiv 2312.06648v3). Extract atomic self-contained propositions as retrieval units. Significantly outperforms passage-level on fine-grained QA; cost is an extra LLM call per document at ingest time. Complementary to late chunking.
3. **Structure-aware boundaries** (GraLC-RAG, Mortezaagha & Rahgozar 2026, arXiv 2603.22633). Use IMRaD section detection (introduction, methods, results, discussion) as natural chunk boundaries, optionally fused with knowledge-graph entity links (UMLS for biomed; ACM CCS / arXiv categories for CS). MRR on single-section questions drops slightly but *SecCov@k* (fraction of structural sections surfaced) jumps up to 15×. For literature review, SecCov dominates MRR because answering a cross-section question ("how do these papers' methods compare?") requires retrieving from multiple sections of each paper.

**What we ship in PR 1.** Sentence-boundary chunking (unchanged). **Why:** zero change to the existing embedding service. **What's next.** Before scaling to >100 papers per project, swap in late chunking with a long-context embedder (jina-embeddings-v3 or similar). Proposition-based indexing is a paper-by-paper ingest-time cost; probably worth prototyping on the CS-education corpus first.

The bigger point: **chunking strategy is the single biggest lever on retrieval quality, and it's invisible to the agent.** Right now we're probably leaving 5–15 points of nDCG on the floor because we index prose papers with a strategy meant for blog posts. We should instrument retrieval quality (Ragas, Es et al. 2023) before committing to any of these.

---

## 4. Project memory across agent sessions

MemGPT's insight generalizes: an LLM "OS" needs tiered memory. Applied to our setup:

- **L1 — working context.** The `get_project_context` blob: ≤ `max_tokens` (default 100K), cached by the calling agent for 5 minutes (Anthropic ephemeral cache TTL). Always the first system content block.
- **L2 — retrieval memory.** The full chunks + note_embeddings tables, queried via `rag_over_project`. Never loaded in full.
- **L3 — episodic memory.** Agent-sourced highlights + notes (this PR's `annotate_on_behalf`). Each carries `agent_source = {agent_id, created_at}`. This is the *writing-back* channel that lets successive agent sessions accumulate work. Letta (the productization of MemGPT) frames this exactly: agents have a small pinned context + a growing "archival memory" they write to.
- **L4 — evergreen notes.** Human-authored Matuschak-style evergreen notes. Full content in L1; also in L2 via `note_embeddings`. These are the *densely-linked substrate* that should remain stable across sessions and anchor the agent's synthesis.

The key design decision is that **L3 is never silently merged into L1.** Agent-written notes are tagged so the user can audit them; they don't automatically become part of the trusted context until the user promotes them. This protects against the well-documented problem of memory corruption in long-horizon agents (Mem2ActBench, Shen et al. 2026, arXiv 2601.19935, shows current memory frameworks fail at actively applying memory to execute tasks).

---

## 5. Token-caching economics for research workflows

Assumptions (calibrated to Hudson's actual usage patterns; revise when we have telemetry):

- **Session length.** A focused literature-review session is 1–3 hours. Within it, the agent issues 20–80 tool calls to the same project scope.
- **Context blob size.** ~10–40K tokens for a ~50-item project with 20 evergreen notes (measured empirically on the CS-education topic group).
- **Cache TTL.** Anthropic ephemeral cache = 5 min default; 1 hour with the beta header. Most tool calls fall within 5 min of each other.
- **Cache pricing.** Write = 1.25× base input; read = 0.1× base input. Break-even: ~(1.25 − 0.1) ÷ (1.0 − 0.1) ≈ 1.28 reads before a write pays back.

**Expected cache hit rate for a typical session.**

```
Queries per session:        40          (midpoint of 20–80)
Context rebuilds/session:    2          (initial + one version bump)
Reads:                      38          (queries after cache warm)
Writes:                      2
Hit rate:                   38 / 40 ≈ 95%
```

Even with a conservative `20 queries / 3 rebuilds` scenario, hit rate sits at 85%. Compared to sending the full blob uncached every time, the session's token cost on the cached portion drops by roughly `1 − (writes × 1.25 + reads × 0.1) / (queries × 1.0) = 1 − (2.5 + 3.8) / 40 ≈ 84%`.

**Where caching does *not* pay off.**

- Cross-session work: the 5-min TTL means Monday-morning context is re-written on Tuesday. Beta 1-hour TTL helps intraday; for true persistence we'd need the agent to re-hit `get_project_context` at session start and pay the write cost once.
- Cross-project pivots: every `project_path` change invalidates the cache.
- Small projects: the 1024-token minimum cacheable block means projects with 2–3 items won't benefit; our blob only exceeds 1K tokens for projects of ~8+ items.

The `context_version` field we return is the guard: when it changes, the agent must re-write the cache, because at least one item or note has mutated. That's also why `index_project` and `save_to_project` are the only operations that should plausibly bump the version within a session.

---

## References

- Ali et al., 2024. *Automated Literature Review Using NLP Techniques and LLM-Based Retrieval-Augmented Generation.* [arXiv:2411.18583](https://arxiv.org/abs/2411.18583)
- Aghajani Asl et al., 2025. *FAIR-RAG: Faithful Adaptive Iterative Refinement for RAG.* [arXiv:2510.22344](https://arxiv.org/abs/2510.22344)
- Bai et al., 2024. *LongBench v2.* [arXiv:2412.15204](https://arxiv.org/abs/2412.15204)
- Chen et al., 2023. *Dense X Retrieval: What Retrieval Granularity Should We Use?* [arXiv:2312.06648](https://arxiv.org/abs/2312.06648)
- Es et al., 2023. *Ragas: Automated Evaluation of RAG.* [arXiv:2309.15217](https://arxiv.org/abs/2309.15217)
- Günther et al., 2024. *Late Chunking.* [arXiv:2409.04701](https://arxiv.org/abs/2409.04701)
- Hsieh et al., 2024. *RULER.* [arXiv:2404.06654](https://arxiv.org/abs/2404.06654)
- Merola & Singh, 2025. *Reconstructing Context: Evaluating Advanced Chunking Strategies.* [arXiv:2504.19754](https://arxiv.org/abs/2504.19754)
- Mortezaagha & Rahgozar, 2026. *GraLC-RAG.* [arXiv:2603.22633](https://arxiv.org/abs/2603.22633)
- Packer et al., 2023. *MemGPT: LLMs as Operating Systems.* [arXiv:2310.08560](https://arxiv.org/abs/2310.08560)
- Shen et al., 2026. *Mem2ActBench.* [arXiv:2601.19935](https://arxiv.org/abs/2601.19935)
- Wampler et al., 2025. *Engineering the RAG Stack.* [arXiv:2601.05264](https://arxiv.org/abs/2601.05264)
- Yang et al., 2025. *100-LongBench.* [arXiv:2505.19293](https://arxiv.org/abs/2505.19293)
- Zhang et al., 2026. *HiMem.* [arXiv:2601.06377](https://arxiv.org/abs/2601.06377)
- Anthropic. *Prompt caching documentation.* <https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching>
- Matuschak. *Evergreen notes.* <https://notes.andymatuschak.org/Evergreen_notes>
