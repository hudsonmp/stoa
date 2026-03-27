"""Keyword-based topic classifier for papers.

Assigns a research topic to a paper based on title, abstract, and venue.
Uses simple keyword matching — no LLM calls. Designed to be called during
ingest or on-demand when grouping papers.
"""

import re
from typing import Optional

# Each rule: (topic_label, keywords, weight_boost_for_title)
# Keywords are matched case-insensitively against title + abstract.
# Order matters: first match wins for single-topic assignment,
# but we score all and pick the highest.
TOPIC_RULES: list[tuple[str, list[str]]] = [
    ("Computing Education", [
        "education", "student", "learning", "pedagogy", "teaching",
        "cs1", "cs2", "introductory programming", "novice programmer",
        "code comprehension", "computing education", "cse", "icer",
        "sigcse", "iticse", "classroom", "curriculum", "instructor",
        "tutoring", "tutor", "mastery learning", "scaffolding",
        "constructionism", "instructionism", "educational",
    ]),
    ("Requirements Engineering", [
        "requirement", "specification", "requirements engineering",
        "user story", "use case", "stakeholder", "elicitation",
        "underspecification", "underspecified", "ambiguity",
        "test case", "acceptance test", "software testing",
        "test-driven", "tdd", "black-box test", "blackbox test",
    ]),
    ("Large Language Models", [
        "language model", "llm", "transformer", "gpt", "bert",
        "attention mechanism", "fine-tuning", "fine-tune",
        "prompt engineering", "prompting", "in-context learning",
        "rlhf", "dpo", "self-rewarding", "chain-of-thought",
        "instruction following", "alignment", "mistral", "llama",
        "code generation", "code llm",
    ]),
    ("Human-Computer Interaction", [
        "hci", "interaction", "user study", "usability",
        "user experience", "ux", "interface design", "accessibility",
        "human factors", "chi ", "cscw", "proactive ai",
        "human-ai", "human-centered", "user-centered",
    ]),
    ("Software Engineering", [
        "software engineering", "debugging", "refactoring",
        "code review", "continuous integration", "devops",
        "version control", "agile", "software development",
        "program analysis", "static analysis", "code quality",
        "software fairness", "software bias",
    ]),
    ("Artificial Intelligence", [
        "artificial intelligence", "machine learning", "neural network",
        "deep learning", "reinforcement learning", "classification",
        "supervised learning", "unsupervised learning",
        "computer vision", "natural language processing", "nlp",
    ]),
    ("Cognitive Science", [
        "cognition", "cognitive", "cognitive load", "working memory",
        "metacognition", "transfer", "schema", "cognitive apprenticeship",
        "zone of proximal development", "social cognition",
        "cultural intelligence", "cognitive science",
        "bloom", "vygotsky", "piaget",
    ]),
    ("Information Theory", [
        "information theory", "entropy", "communication theory",
        "channel capacity", "coding theory", "shannon",
    ]),
    ("Mathematics", [
        "mathematical", "mathematics", "calculus", "algebra",
        "topology", "number theory", "proof", "theorem",
        "effectiveness of mathematics",
    ]),
]

# Venue → topic mapping (exact or substring match on citation.venue)
VENUE_TOPICS: dict[str, str] = {
    "chi": "Human-Computer Interaction",
    "cscw": "Human-Computer Interaction",
    "uist": "Human-Computer Interaction",
    "iui": "Human-Computer Interaction",
    "dis": "Human-Computer Interaction",
    "sigcse": "Computing Education",
    "icer": "Computing Education",
    "iticse": "Computing Education",
    "aied": "Computing Education",
    "l@s": "Computing Education",
    "las": "Computing Education",
    "lak": "Computing Education",
    "neurips": "Artificial Intelligence",
    "nips": "Artificial Intelligence",
    "icml": "Artificial Intelligence",
    "iclr": "Artificial Intelligence",
    "aaai": "Artificial Intelligence",
    "acl": "Large Language Models",
    "emnlp": "Large Language Models",
    "naacl": "Large Language Models",
    "icse": "Software Engineering",
    "fse": "Software Engineering",
    "ase": "Software Engineering",
    "issta": "Software Engineering",
    "re ": "Requirements Engineering",
    "requirements engineering": "Requirements Engineering",
    "cogsci": "Cognitive Science",
    "cognitive science": "Cognitive Science",
}


def classify_topic(
    title: str,
    abstract: Optional[str] = None,
    venue: Optional[str] = None,
    tags: Optional[list[str]] = None,
    propositions: Optional[list[dict]] = None,
) -> str:
    """Classify a paper into a research topic.

    Priority:
    1. Venue match (if citation has a known venue)
    2. Keyword scoring on title + abstract
    3. Tag-based fallback
    4. "Uncategorized"
    """
    # 1. Venue match
    if venue:
        venue_lower = venue.lower()
        for venue_key, topic in VENUE_TOPICS.items():
            if venue_key in venue_lower:
                return topic

    # 2. Keyword scoring
    text = (title or "").lower()
    if abstract:
        text += " " + abstract.lower()
    # Include proposition text if available
    if propositions:
        for p in propositions:
            if isinstance(p, dict):
                text += " " + (p.get("text", "") + " " + p.get("normalized", "")).lower()

    best_topic = None
    best_score = 0

    for topic_label, keywords in TOPIC_RULES:
        score = 0
        for kw in keywords:
            # Title matches count double
            if kw in (title or "").lower():
                score += 2
            if kw in text:
                score += 1
        if score > best_score:
            best_score = score
            best_topic = topic_label

    if best_topic and best_score >= 2:
        return best_topic

    # 3. Tag fallback
    if tags:
        tag_text = " ".join(t.lower() for t in tags)
        for topic_label, keywords in TOPIC_RULES:
            for kw in keywords:
                if kw in tag_text:
                    return topic_label

    return "Uncategorized"


def classify_papers_batch(
    papers: list[dict],
    citations: Optional[dict[str, dict]] = None,
    tags_map: Optional[dict[str, list[str]]] = None,
) -> dict[str, list[dict]]:
    """Classify a list of papers and return them grouped by topic.

    Args:
        papers: List of item dicts (must have 'id', 'title', 'metadata').
        citations: Optional dict mapping item_id → citation dict.
        tags_map: Optional dict mapping item_id → list of tag names.

    Returns:
        Dict mapping topic_name → list of paper dicts, sorted by count descending.
    """
    groups: dict[str, list[dict]] = {}

    for paper in papers:
        item_id = paper["id"]
        title = paper.get("title", "")
        metadata = paper.get("metadata") or {}
        propositions = metadata.get("propositions")

        citation = (citations or {}).get(item_id, {})
        abstract = citation.get("abstract")
        venue = citation.get("venue")

        item_tags = (tags_map or {}).get(item_id)

        topic = classify_topic(
            title=title,
            abstract=abstract,
            venue=venue,
            tags=item_tags,
            propositions=propositions,
        )

        if topic not in groups:
            groups[topic] = []
        groups[topic].append(paper)

    # Sort groups by count descending, but keep "Uncategorized" last
    sorted_groups = dict(
        sorted(
            groups.items(),
            key=lambda kv: (kv[0] == "Uncategorized", -len(kv[1])),
        )
    )

    return sorted_groups
