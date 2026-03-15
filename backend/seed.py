#!/usr/bin/env python3
"""Seed script: populate Stoa with Hudson's milieu data."""

import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_KEY"),
)

# You'll need to set this to your actual user ID after first login
USER_ID = os.getenv("STOA_USER_ID", "")

PEOPLE = [
    {"name": "Dwarkesh Patel", "role": "intellectual hero", "affiliation": "Dwarkesh Podcast", "website_url": "https://dwarkeshpatel.com", "twitter_handle": "dwaborin", "tags": ["podcasting", "AI", "civilization"]},
    {"name": "Tyler Cowen", "role": "intellectual hero", "affiliation": "George Mason University", "website_url": "https://marginalrevolution.com", "twitter_handle": "tylercowen", "tags": ["economics", "culture"]},
    {"name": "Henrik Karlsson", "role": "intellectual hero", "website_url": "https://henrikkarlsson.xyz", "twitter_handle": "henrikkarls", "tags": ["self-directed-learning", "social-graphs", "essays"]},
    {"name": "Paul Graham", "role": "intellectual hero", "affiliation": "Y Combinator", "website_url": "https://paulgraham.com", "twitter_handle": "paulg", "tags": ["startups", "essays", "ambition"]},
    {"name": "Dario Amodei", "role": "intellectual hero", "affiliation": "Anthropic", "twitter_handle": "DarioAmodei", "tags": ["AI-safety", "beneficial-AI"]},
    {"name": "Andrej Karpathy", "role": "intellectual hero", "website_url": "https://karpathy.ai", "twitter_handle": "karpathy", "tags": ["AI", "education", "neural-networks"]},
    {"name": "Fei-Fei Li", "role": "intellectual hero", "affiliation": "Stanford HAI", "tags": ["computer-vision", "AI", "human-AI-interaction"]},
    {"name": "Jeff Dean", "role": "intellectual hero", "affiliation": "Google DeepMind", "tags": ["systems", "AI", "scale"]},
    {"name": "Geoffrey Hinton", "role": "intellectual hero", "affiliation": "University of Toronto", "tags": ["deep-learning", "neural-networks"]},
    {"name": "Claude Shannon", "role": "intellectual hero", "affiliation": "Bell Labs / MIT", "tags": ["information-theory", "mathematics"]},
    {"name": "Robert Oppenheimer", "role": "intellectual hero", "tags": ["physics", "ambition", "scientific-purpose"]},
    {"name": "Anson Yu", "role": "peer", "twitter_handle": "ansonyu___", "tags": ["research", "self-directed-learning"]},
    {"name": "Laker Newhouse", "role": "peer", "tags": ["research", "self-directed-learning"]},
    {"name": "Selene Zhang", "role": "peer", "tags": ["research"]},
    {"name": "Aileen Luo", "role": "peer", "tags": ["research"]},
    {"name": "Annapurna Vadaparty", "role": "mentor", "affiliation": "UCSD", "tags": ["HCI", "CS-education"]},
    {"name": "Qianou Ma", "role": "mentor", "affiliation": "CMU HCII", "twitter_handle": "christinaqma", "tags": ["HCI", "learning-science"]},
    {"name": "David Smith", "role": "mentor", "affiliation": "Virginia Tech", "tags": ["CS-education", "requirement-engineering"]},
]

ITEMS = [
    # Books (from hudsonmp.github.io/library)
    {"title": "Zero to One", "type": "book", "domain": "Peter Thiel & Blake Masters", "reading_status": "read"},
    {"title": "The Worlds I See", "type": "book", "domain": "Fei-Fei Li", "reading_status": "read"},
    {"title": "The Alchemist", "type": "book", "domain": "Paulo Coelho", "reading_status": "read"},
    {"title": "Elon Musk", "type": "book", "domain": "Walter Isaacson", "reading_status": "read"},
    {"title": "Einstein: His Life and Universe", "type": "book", "domain": "Walter Isaacson", "reading_status": "read"},
    {"title": "Architects of Intelligence", "type": "book", "domain": "Martin Ford", "reading_status": "read"},
    # Blogs (milieu)
    {"title": "Marginal Revolution", "url": "https://marginalrevolution.com", "type": "blog", "domain": "marginalrevolution.com"},
    {"title": "Escaping Flatland", "url": "https://henrikkarlsson.xyz", "type": "blog", "domain": "henrikkarlsson.xyz"},
    {"title": "First We Shape Our Social Graph, Then It Shapes Us", "url": "https://henrikkarlsson.xyz/p/first-we-shape-our-social-graph", "type": "blog", "domain": "henrikkarlsson.xyz"},
    {"title": "Childhoods of Exceptional People", "url": "https://henrikkarlsson.xyz/p/childhoods", "type": "blog", "domain": "henrikkarlsson.xyz"},
    {"title": "How to Do Great Work", "url": "https://paulgraham.com/greatwork.html", "type": "blog", "domain": "paulgraham.com"},
    {"title": "You and Your Research (Hamming)", "url": "https://paulgraham.com/hamming.html", "type": "blog", "domain": "paulgraham.com"},
    {"title": "Machines of Loving Grace", "url": "https://darioamodei.com/machines-of-loving-grace", "type": "blog", "domain": "darioamodei.com"},
    {"title": "The Intrinsic Perspective", "url": "https://theintrinsicperspective.com", "type": "blog", "domain": "theintrinsicperspective.com"},
    {"title": "benkuhn.net/college", "url": "https://benkuhn.net/college", "type": "blog", "domain": "benkuhn.net"},
    {"title": "Advice - Patrick Collison", "url": "https://patrickcollison.com/advice", "type": "blog", "domain": "patrickcollison.com"},
    # Hudson's writings
    {"title": "Transforming Societies", "url": "https://hudsonmp.github.io/blog/2026/transforming-societies/", "type": "blog", "domain": "hudsonmp.github.io", "reading_status": "read"},
    {"title": "Why do we Learn STEM?", "url": "https://hudsonmp.github.io/blog/2026/why-do-we-learn-stem/", "type": "blog", "domain": "hudsonmp.github.io", "reading_status": "read"},
    {"title": "Who Was I (part I)?", "url": "https://hudsonmp.github.io/blog/2026/first-post/", "type": "blog", "domain": "hudsonmp.github.io", "reading_status": "read"},
    # Podcasts (from hudsonmp.github.io/library)
    {"title": "Dwarkesh Podcast - Demis Hassabis", "url": "https://www.dwarkeshpatel.com/p/demis-hassabis", "type": "podcast", "domain": "dwarkeshpatel.com"},
    {"title": "Lex Fridman - Andrej Karpathy", "url": "https://lexfridman.com/andrej-karpathy/", "type": "podcast", "domain": "lexfridman.com"},
    {"title": "The Future of Everything", "type": "podcast", "domain": "Stanford Engineering", "summary": "Hosted by Russ Altman"},
    {"title": "Education Futures", "type": "podcast", "domain": "Svenia Busson"},
    {"title": "Founders Podcast", "type": "podcast", "domain": "David Senra"},
    {"title": "The Diary of a CEO", "type": "podcast", "domain": "Steven Bartlett"},
    {"title": "HCI Ideas", "type": "podcast", "domain": "CMU HCII"},
    {"title": "EdTech Insiders", "type": "podcast", "domain": "Alex Sarlin & Ben Kornell"},
    {"title": "The Daily", "type": "podcast", "domain": "The New York Times"},
    # Papers
    {"title": "Attention Is All You Need", "url": "https://arxiv.org/abs/1706.03762", "type": "paper", "domain": "arxiv.org"},
    {"title": "The Unreasonable Effectiveness of Mathematics", "url": "https://www.dartmouth.edu/~matc/MathDrama/reading/Wigner.html", "type": "paper", "domain": "dartmouth.edu"},
    {"title": "Constructionism vs Instructionism", "url": "https://www.papert.org/articles/SituatingConstructionism.html", "type": "paper", "domain": "papert.org"},
    {"title": "A Mathematical Theory of Communication", "url": "https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf", "type": "paper", "domain": "harvard.edu"},
    {"title": "The Cognitive Apprenticeship Framework", "url": "https://doi.org/10.1207/s15326985ep2101_1", "type": "paper", "domain": "doi.org"},
]

COLLECTIONS = [
    {"name": "Friday Evening Reading", "description": "Deep essays for weekend reflection"},
    {"name": "Context Engineering", "description": "Research on context engineering for LLMs"},
    {"name": "Learning Science Foundations", "description": "Key papers in cognitive and learning science"},
]

TAGS = [
    "context-engineering", "learning-science", "HCI", "self-directed-learning",
    "AI-safety", "cognitive-science", "CS-education", "essays", "ambition",
    "requirement-engineering", "transfer-theory",
]


def seed():
    if not USER_ID:
        print("Set STOA_USER_ID environment variable first")
        print("(Get your user ID after signing in to the webapp)")
        return

    print("Seeding people...")
    for p in PEOPLE:
        supabase.table("people").upsert(
            {**p, "user_id": USER_ID},
            on_conflict="user_id,name",
        ).execute()
    print(f"  {len(PEOPLE)} people added")

    print("Seeding items...")
    for item in ITEMS:
        supabase.table("items").upsert(
            {**item, "user_id": USER_ID, "reading_status": "to_read"},
            on_conflict="user_id,url",
        ).execute()
    print(f"  {len(ITEMS)} items added")

    print("Seeding collections...")
    for col in COLLECTIONS:
        supabase.table("collections").insert(
            {**col, "user_id": USER_ID}
        ).execute()
    print(f"  {len(COLLECTIONS)} collections added")

    print("Seeding tags...")
    for tag in TAGS:
        supabase.table("tags").upsert(
            {"user_id": USER_ID, "name": tag},
            on_conflict="user_id,name",
        ).execute()
    print(f"  {len(TAGS)} tags added")

    print("Done!")


if __name__ == "__main__":
    seed()
