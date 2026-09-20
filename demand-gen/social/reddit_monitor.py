"""
Surfaces public posts where someone explicitly asks for an outsourcing/BPO
partner, using Reddit's public search JSON endpoint (no API key, no login,
no OAuth app needed for read-only access).

This only looks at posts that ARE ALREADY asking for this -- it does not
search for any proxy signal and does not treat anyone as a lead who hasn't
said, in public, that they're looking. It never posts anything itself: the
output is a digest of drafted, non-pitchy replies for a human to read,
personalize if needed, and post themselves. Posting as a business account
without a human reading the actual post first is how a genuinely helpful
reply turns into spam -- that step stays manual on purpose.
"""
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

HEADERS = {"User-Agent": "bpo-demand-gen/1.0 (contact: sales@growthsupplyhouse.com)"}
SEARCH_URL = "https://www.reddit.com/search.json"

# Subreddits where a small/mid-size business owner might plausibly ask this.
SUBREDDITS = ["smallbusiness", "Entrepreneur", "ecommerce", "startups"]

# Deliberately narrow and explicit -- these only match someone who is
# actually asking for outsourcing help, not someone hiring internally or
# just mentioning customer service in passing.
QUERIES = [
    "looking for a call center partner",
    "need to outsource customer support",
    "recommend a BPO provider",
    "outsourced customer service company recommendations",
    "virtual assistant company recommendations",
]

DIGEST_DIR = Path(__file__).parent / "digest"
SEEN_FILE = Path(__file__).parent / "seen.json"


def search(query, subreddit):
    params = {
        "q": f"{query} subreddit:{subreddit}",
        "sort": "new",
        "limit": 15,
        "restrict_sr": "on",
        "t": "week",
    }
    try:
        r = requests.get(SEARCH_URL, params=params, headers=HEADERS, timeout=20)
        if r.status_code != 200:
            print(f"reddit search failed for {query!r} in r/{subreddit}: HTTP {r.status_code}", file=sys.stderr)
            return []
        data = r.json()
    except Exception as e:
        print(f"reddit search error for {query!r}: {e}", file=sys.stderr)
        return []
    out = []
    for child in data.get("data", {}).get("children", []):
        post = child.get("data", {})
        out.append({
            "id": post.get("id"),
            "title": post.get("title", ""),
            "body": (post.get("selftext") or "")[:800],
            "subreddit": post.get("subreddit"),
            "author": post.get("author"),
            "url": "https://www.reddit.com" + post.get("permalink", ""),
            "created_utc": post.get("created_utc"),
        })
    return out


def draft_reply(post):
    return (
        "Not trying to sell you anything here, just answering the actual question -- "
        "we run outsourced customer support / back-office desks for small businesses "
        "(managed process, not a staffing marketplace). Happy to talk through what "
        "you're dealing with if it'd help, no pressure either way."
    )


def load_seen():
    if SEEN_FILE.exists():
        return set(json.loads(SEEN_FILE.read_text()))
    return set()


def save_seen(seen):
    SEEN_FILE.write_text(json.dumps(sorted(seen)))


def main():
    seen = load_seen()
    all_posts = {}
    for query in QUERIES:
        for subreddit in SUBREDDITS:
            for post in search(query, subreddit):
                if post.get("id"):
                    all_posts[post["id"]] = post
            time.sleep(1)  # be polite to Reddit's public endpoint

    new_posts = [p for p in all_posts.values() if p["id"] not in seen]
    print(f"found {len(all_posts)} matching posts, {len(new_posts)} new")

    if not new_posts:
        return

    DIGEST_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    digest_path = DIGEST_DIR / f"{now.strftime('%Y-%m-%d')}.md"

    lines = [f"# Reddit digest -- {now.strftime('%Y-%m-%d %H:%M')} UTC (review before posting anything)\n"]
    for post in new_posts:
        lines.append(f"## {post['title']}")
        lines.append(f"- r/{post['subreddit']} · u/{post['author']}")
        lines.append(f"- Link: {post['url']}")
        if post.get("body"):
            lines.append(f"- Post text: {post['body']}")
        lines.append("\n**Drafted reply (read the actual post first, edit before posting):**\n")
        lines.append(f"> {draft_reply(post)}\n")

    existing = digest_path.read_text() if digest_path.exists() else ""
    digest_path.write_text(existing + "\n".join(lines) + "\n")

    seen.update(p["id"] for p in new_posts)
    save_seen(seen)
    print(f"wrote {digest_path}")


if __name__ == "__main__":
    main()
