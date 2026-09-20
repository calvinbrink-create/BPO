"""
Surfaces published UK procurement notices for outsourcing/BPO-type work from
the two official, keyless OCDS APIs: Contracts Finder (below-threshold,
England-wide) and Find a Tender (above-threshold, UK-wide).

A published tender is real, budgeted, already-signaled demand for exactly
this kind of work -- unlike a company hiring an internal support rep, which
says nothing about wanting to outsource. That's the line this script holds:
it only ever surfaces opportunities for a human to look at and respond to.

It NEVER submits a bid. Submitting a response to a public tender is a legal
act with real consequences for a real procurement process; automating that
away would be a different, much worse mistake than the one this whole
demand-gen system exists to avoid repeating. This script's only output is a
markdown digest for a human to read and act on.
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

HEADERS = {"User-Agent": "Mozilla/5.0"}
CONTRACTS_FINDER_SEARCH = "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search"
FIND_A_TENDER_FEED = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"

TENDER_KEYWORDS = [
    "call centre", "call center", "contact centre", "contact center",
    "back office", "outsourc", "customer service", "telephony", "bpo",
]

DIGEST_DIR = Path(__file__).parent / "digest"
SEEN_FILE = Path(__file__).parent / "seen.json"


def matches_keywords(text):
    t = (text or "").lower()
    return any(k in t for k in TENDER_KEYWORDS)


def fetch_contracts_finder(keyword_query="call centre OR back office OR outsourcing"):
    params = {"keyword": keyword_query, "size": 100, "stages": "tender"}
    try:
        r = requests.get(CONTRACTS_FINDER_SEARCH, params=params, headers=HEADERS, timeout=30)
        if r.status_code != 200:
            print(f"contracts finder: HTTP {r.status_code}", file=sys.stderr)
            return []
        data = r.json()
    except Exception as e:
        print(f"contracts finder: {e}", file=sys.stderr)
        return []
    releases = data.get("releases", [])
    print(f"contracts finder: {len(releases)} releases returned for query", file=sys.stderr)
    out = []
    for release in releases:
        tender = release.get("tender", {})
        title = tender.get("title", "")
        desc = tender.get("description", "")
        if matches_keywords(title) or matches_keywords(desc):
            buyer = release.get("buyer", {})
            out.append({
                "source": "uk_tender_cf",
                "ocid": release.get("ocid"),
                "buyer": buyer.get("name"),
                "title": title,
                "description": desc[:500],
                "url": f"https://www.contractsfinder.service.gov.uk/Notice/{release.get('id', '')}",
                "date": release.get("date"),
            })
    return out


def fetch_find_a_tender():
    try:
        r = requests.get(FIND_A_TENDER_FEED, headers=HEADERS, timeout=30)
        if r.status_code != 200:
            print(f"find a tender: HTTP {r.status_code}", file=sys.stderr)
            return []
        data = r.json()
    except Exception as e:
        print(f"find a tender: {e}", file=sys.stderr)
        return []
    out = []
    packages = data.get("releasePackages") or data.get("releases") or []
    total_releases = 0
    for pkg in packages:
        releases = pkg.get("releases", [pkg]) if isinstance(pkg, dict) else []
        total_releases += len(releases)
        for release in releases:
            tender = release.get("tender", {})
            title = tender.get("title", "")
            desc = tender.get("description", "")
            if matches_keywords(title) or matches_keywords(desc):
                buyer = release.get("buyer", {})
                docs = tender.get("documents") or []
                out.append({
                    "source": "uk_tender_fts",
                    "ocid": release.get("ocid"),
                    "buyer": buyer.get("name"),
                    "title": title,
                    "description": desc[:500],
                    "url": docs[0].get("url", "") if docs else "",
                    "date": release.get("date"),
                })
    print(f"find a tender: {len(packages)} packages / {total_releases} releases returned (unfiltered feed)", file=sys.stderr)
    return out


def draft_response(item):
    return (
        f"Hi,\n\nI saw your notice for \"{item['title']}\" ({item['buyer'] or 'your organisation'}) "
        f"-- we run outsourced back-office / contact centre operations for organisations with "
        f"this kind of requirement, and can put together a formal response or a call whenever's "
        f"useful.\n\nBest,\nGrowth Supply House"
    )


def load_seen():
    if SEEN_FILE.exists():
        return set(json.loads(SEEN_FILE.read_text()))
    return set()


def save_seen(seen):
    SEEN_FILE.write_text(json.dumps(sorted(seen)))


def main():
    items = fetch_contracts_finder() + fetch_find_a_tender()
    seen = load_seen()
    new_items = [i for i in items if i.get("ocid") and i["ocid"] not in seen]

    print(f"fetched {len(items)} matching notices, {len(new_items)} new")

    # Always ensure these paths exist, even on a 0-new run (the common case)
    # - the workflow's `git add` fails outright on a genuinely missing path,
    # which used to turn "nothing new today" into a hard failure every time.
    DIGEST_DIR.mkdir(parents=True, exist_ok=True)
    seen.update(i["ocid"] for i in items if i.get("ocid"))
    save_seen(seen)

    if not new_items:
        return

    now = datetime.now(timezone.utc)
    digest_path = DIGEST_DIR / f"{now.strftime('%Y-%m-%d')}.md"

    lines = [f"# Tender digest -- {now.strftime('%Y-%m-%d %H:%M')} UTC\n"]
    for item in new_items:
        lines.append(f"## {item['title']}")
        lines.append(f"- Buyer: {item.get('buyer') or 'unknown'}")
        lines.append(f"- Source: {item['source']}  ·  Date: {item.get('date') or 'unknown'}")
        lines.append(f"- Link: {item.get('url') or '(none)'}")
        if item.get("description"):
            lines.append(f"- Description: {item['description']}")
        lines.append("\n**Drafted response (review before sending, never auto-submitted):**\n")
        lines.append(f"> {draft_response(item)}\n")

    existing = digest_path.read_text() if digest_path.exists() else ""
    digest_path.write_text(existing + "\n".join(lines) + "\n")
    print(f"wrote {digest_path}")


if __name__ == "__main__":
    main()
