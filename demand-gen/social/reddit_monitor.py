"""
Surfaces public posts where someone explicitly asks for an outsourcing/BPO
partner, using Reddit's OAuth search API.

This only looks at posts that ARE ALREADY asking for this -- it does not
search for any proxy signal and does not treat anyone as a lead who hasn't
said, in public, that they're looking. It never posts anything itself: the
output is a digest of drafted, non-pitchy replies for a human to read,
personalize if needed, and post themselves. Posting as a business account
without a human reading the actual post first is how a genuinely helpful
reply turns into spam -- that step stays manual on purpose.

Uses OAuth (application-only, client_credentials grant) rather than the
anonymous www.reddit.com/*.json endpoints: those get a blanket HTTP 403 from
Reddit's own bot-detection layer for requests coming from cloud/datacenter
IP ranges, GitHub Actions runners included -- confirmed by actually running
this against the live endpoint before switching approaches, not assumed.
OAuth app-only auth is Reddit's own documented path for exactly this kind
of scripted, read-only access to public data.

Requires REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET (a free "script"-type app,
see demand-gen/README.md for the two-minute setup). Skips gracefully -- logs
and exits 0 -- if they aren't configured yet, rather than failing the job.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

USER_AGENT = "bpo-demand-gen/1.0 (by /u/growthsupplyhouse; contact sales@growthsupplyhouse.com)"
TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
SEARCH_URL = "https://oauth.reddit.com/r/{subreddit}/search"

SUBREDDITS = ["smallbusiness", "Entrepreneur", "ecommerce", "startups"]

QUERIES = [
    "looking for a call center partner",
    "need to outsource customer support",
    "recommend a BPO provider",
    "outsourced customer service company recommendations",
    "virtual assistant company recommendations",
]

DIGEST_DIR = Path(__file__).parent / "digest"
SEEN_FILE = Path(__file__).parent / "seen.json"


def get_token():
    client_id = os.environ.get("REDDIT_CLIENT_ID")
    client_secret = os.environ.get("REDDIT_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None
    try:
        r = requests.post(
            TOKEN_URL,
            auth=(client_id, client_secret),
            data={"grant_type": "client_credentials"},
            headers={"User-Agent": USER_AGENT},
            timeout=20,
        )
        if not r.ok:
            print(f"reddit auth failed: HTTP {r.status_code} {r.text[:200]}", file=sys.stderr)
            return None
        return r.json().get("access_token")
    except Exception as e:
        print(f"reddit auth error: {e}", file=sys.stderr)
        return None


def search(token, query, subreddit):
    headers = {"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT}
    params = {"q": query, "sort": "new", "limit": 15, "restrict_sr": "on", "t": "week"}
    try:
        r = requests.get(SEARCH_URL.format(subreddit=subreddit), params=params, headers=headers, timeout=20)
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
    token = get_token()
    if not token:
        print("REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET not configured (or auth failed) - skipping this run.")
        DIGEST_DIR.mkdir(parents=True, exist_ok=True)
        if not SEEN_FILE.exists():
            save_seen(set())
        return

    seen = load_seen()
    all_posts = {}
    for query in QUERIES:
        for subreddit in SUBREDDITS:
            for post in search(token, query, subreddit):
                if post.get("id"):
                    all_posts[post["id"]] = post
            time.sleep(1)  # be polite

    new_posts = [p for p in all_posts.values() if p["id"] not in seen]
    print(f"found {len(all_posts)} matching posts, {len(new_posts)} new")

    # Always ensure these exist, even on a 0-new run - `git add` on a
    # genuinely missing path fails the whole workflow step outright, which
    # used to turn "nothing new today" (the common case) into a hard failure.
    DIGEST_DIR.mkdir(parents=True, exist_ok=True)
    seen.update(all_posts.keys())
    save_seen(seen)

    if not new_posts:
        return

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
    print(f"wrote {digest_path}")


if __name__ == "__main__":
    main()
