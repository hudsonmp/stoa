"""Page classification endpoint using local MLX model on Apple Silicon."""

import json
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)

# Lazy-loaded model (first request takes ~5s to download, subsequent requests are instant)
_model = None
_tokenizer = None
MODEL_NAME = "mlx-community/Qwen2.5-3B-Instruct-4bit"

CLASSIFY_PROMPT = """Classify this web page. Return JSON with type and confidence.

Types: blog, paper, book, podcast, video, tweet, page, writing

URL: {url}
Title: {title}
Description: {description}
OG Type: {og_type}
Article tag: {has_article}
Words: {word_count}
Author: {has_author}
Date: {has_date}
Domain: {domain}

Example responses:
{{"type": "blog", "confidence": 0.92}}
{{"type": "paper", "confidence": 0.85}}
{{"type": "page", "confidence": 0.6}}"""


class ClassifyRequest(BaseModel):
    url: str
    title: str = ""
    description: str = ""
    og_type: str = ""
    has_article: bool = False
    word_count: int = 0
    has_author: bool = False
    has_date: bool = False
    domain: str = ""


def _get_model():
    global _model, _tokenizer
    if _model is None:
        from mlx_lm import load
        logger.info("Loading classification model %s...", MODEL_NAME)
        _model, _tokenizer = load(MODEL_NAME)
        logger.info("Model loaded.")
    return _model, _tokenizer


@router.post("")
async def classify_page(req: ClassifyRequest):
    """Classify a web page using local MLX model."""
    try:
        model, tokenizer = _get_model()
    except Exception as e:
        logger.error("Failed to load model: %s", e)
        raise HTTPException(status_code=503, detail=f"Model load failed: {e}")

    from mlx_lm import generate

    prompt = CLASSIFY_PROMPT.format(
        url=req.url,
        title=req.title,
        description=req.description,
        og_type=req.og_type,
        has_article=req.has_article,
        word_count=req.word_count,
        has_author=req.has_author,
        has_date=req.has_date,
        domain=req.domain,
    )

    # Format as chat message for instruct model
    messages = [{"role": "user", "content": prompt}]
    formatted = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

    try:
        from mlx_lm.sample_utils import make_sampler
        sampler = make_sampler(temp=0.0)
        response = generate(
            model,
            tokenizer,
            prompt=formatted,
            max_tokens=48,
            sampler=sampler,
        )

        # Extract JSON from response
        text = response.strip()
        # Find JSON object in response
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            result = json.loads(text[start:end])
        else:
            result = json.loads(text)

        valid_types = {"blog", "paper", "book", "podcast", "video", "tweet", "page", "writing"}
        rtype = result.get("type", "page")
        if rtype not in valid_types:
            rtype = "page"

        try:
            confidence = float(result.get("confidence", 0.5))
        except (ValueError, TypeError):
            confidence = 0.7
        confidence = max(0.0, min(1.0, confidence))

        return {"type": rtype, "confidence": confidence}
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        logger.warning("Classification parse error: %s, raw: %s", e, response[:200] if 'response' in dir() else "N/A")
        raise HTTPException(status_code=500, detail="Classification parse error")
