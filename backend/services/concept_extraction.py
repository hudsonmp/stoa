"""Concept extraction: structured propositions from paper text via Claude."""

import json
import logging
import os

import anthropic

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """\
You are an academic research analyst. Extract structured propositions from the following paper text.

For each proposition, identify its type and provide both the original statement and a normalized (domain-independent) restatement.

Types:
- **claim**: A testable assertion or hypothesis the authors make
- **method**: A technique, approach, or procedure described
- **finding**: An empirical result or observation reported
- **limitation**: An acknowledged weakness, constraint, or scope boundary
- **research_question**: An explicit or implicit question the paper investigates

For the "normalized" field, restate the proposition in abstract, domain-independent terms that would enable cross-domain matching. Strip jargon, replace specific system names with generic descriptions, and express the core idea in terms of general mechanisms, principles, or patterns.

Return a JSON array of objects, each with:
- "type": one of "claim", "method", "finding", "limitation", "research_question"
- "text": the proposition as stated or closely paraphrased from the paper
- "normalized": domain-independent restatement

Return ONLY the JSON array. No markdown fences, no commentary.

Example output:
[
  {"type": "claim", "text": "Self-rewarding models can improve beyond human-level feedback quality", "normalized": "Systems that generate their own training signal can exceed the quality ceiling of externally provided supervision"},
  {"type": "method", "text": "LLM-as-a-Judge prompting to generate reward scores during DPO training", "normalized": "Using the trained system itself as an evaluator to produce preference labels for iterative optimization"}
]

Paper text:
"""

MAX_INPUT_CHARS = 10000
MODEL = "claude-sonnet-4-20250514"


async def extract_propositions(text: str) -> list[dict]:
    """Extract structured propositions from paper text using Claude.

    Args:
        text: Extracted text from a paper (abstract + intro + body).
              Will be truncated to first ~10000 chars.

    Returns:
        List of {"type": str, "text": str, "normalized": str} dicts.
    """
    if not text or not text.strip():
        return []

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")

    truncated = text[:MAX_INPUT_CHARS]

    client = anthropic.AsyncAnthropic(api_key=api_key)

    message = await client.messages.create(
        model=MODEL,
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": EXTRACTION_PROMPT + truncated,
            }
        ],
    )

    response_text = message.content[0].text.strip()

    # Parse JSON — handle possible markdown fences
    if response_text.startswith("```"):
        lines = response_text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        response_text = "\n".join(lines)

    # Find the JSON array boundaries
    start = response_text.find("[")
    end = response_text.rfind("]") + 1
    if start < 0 or end <= start:
        logger.error("Failed to parse propositions JSON: %s", response_text[:200])
        return []

    propositions = json.loads(response_text[start:end])

    # Validate structure
    valid_types = {"claim", "method", "finding", "limitation", "research_question"}
    validated = []
    for p in propositions:
        if not isinstance(p, dict):
            continue
        if p.get("type") not in valid_types:
            continue
        if not p.get("text") or not p.get("normalized"):
            continue
        validated.append({
            "type": p["type"],
            "text": str(p["text"]),
            "normalized": str(p["normalized"]),
        })

    return validated
