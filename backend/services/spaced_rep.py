"""Spaced repetition using the half-power law (Wozniak/Pimsleur-inspired)."""

from datetime import datetime, timedelta, timezone


# Intervals in hours: 1, 6, 24, 72, 168 (1 week), 720 (1 month), 2160 (3 months)
BASE_INTERVALS = [1, 6, 24, 72, 168, 720, 2160]


def next_review(difficulty: float, repetitions: int, quality: int) -> dict:
    """Calculate next review time based on response quality.

    Args:
        difficulty: Current difficulty (0-1, higher = harder)
        repetitions: Number of successful reviews
        quality: User response quality (0=forgot, 1=hard, 2=good, 3=easy)

    Returns:
        Dict with next_review_at, new_difficulty, new_repetitions
    """
    if quality == 0:
        # Reset on failure
        new_repetitions = 0
        new_difficulty = min(1.0, difficulty + 0.2)
        interval_hours = BASE_INTERVALS[0]
    else:
        new_repetitions = repetitions + 1
        # Adjust difficulty based on quality
        if quality == 1:
            new_difficulty = min(1.0, difficulty + 0.1)
        elif quality == 2:
            new_difficulty = difficulty
        else:  # quality == 3
            new_difficulty = max(0.0, difficulty - 0.1)

        # Get base interval, capped at max
        idx = min(new_repetitions, len(BASE_INTERVALS) - 1)
        base_interval = BASE_INTERVALS[idx]

        # Scale by inverse difficulty (easier items get longer intervals)
        scale = 1.0 + (1.0 - new_difficulty)
        interval_hours = base_interval * scale

    next_time = datetime.now(timezone.utc) + timedelta(hours=interval_hours)

    return {
        "next_review_at": next_time.isoformat(),
        "difficulty": round(new_difficulty, 2),
        "repetitions": new_repetitions,
    }
