"""
Scheduled job: check the landing page's lead store for anyone new, and send
each one a real, personal reply from the sales@growthsupplyhouse.com Gmail
account. Run via .github/workflows/demand-gen-outreach.yml.

This is legitimate in a way the earlier, rejected AutoBPO design was not:
every person contacted here chose to submit inquire.html themselves. Nobody
is cold-emailed based on a guess about their interest.

What this deliberately does NOT do: invoice anyone. There is currently no
reviewed, deployed capability-token invoicing API in production (see the
repo root README) - even once there is, an invoice will only ever be
created by someone explicitly clicking an "accept & pay" link, never by
this script parsing a reply. This script's only job is the first, honest
human-sounding reply to someone who asked a question.

Requires:
  LEADS_API_URL      e.g. https://bpo-control-dashboard.vercel.app/api/leads
  ADMIN_SECRET       bearer token for that endpoint
  SMTP_HOST/PORT/USER/PASS   same Gmail app password already used elsewhere
  FROM_NAME          e.g. "Calvin - Growth Supply House"
"""
import os
import smtplib
import sys
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import requests

LEADS_API_URL = os.environ.get("LEADS_API_URL", "https://bpo-control-dashboard.vercel.app/api/leads")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "")

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
FROM_NAME = os.environ.get("FROM_NAME", "Growth Supply House")

TIER_LABELS = {
    "starter": "a single process on business-hours coverage",
    "growth": "a few processes with extended-hours coverage",
    "scale": "full desk coverage, 24/5",
    "not_sure": "whatever fits best once we know more",
}

REPLY_TEMPLATE = """Hi {first_name},

Thanks for reaching out through the site. You mentioned:

    "{message}"

That's exactly the kind of thing we take off a team's plate — sounds like \
{tier_label} would be the starting point, but happy to adjust once I \
understand the volume and hours involved.

Could you give me a rough sense of:
  - how many contacts/tickets/calls a week this covers today
  - what hours you need covered
  - anything that's a hard requirement (a specific tool, language, etc.)

Once I have that I'll send over a straightforward proposal — no obligation, \
and nothing gets billed until you tell me to go ahead.

Best,
{from_name}
"""


def first_name(full_name):
    return (full_name or "there").strip().split(" ")[0]


def fetch_leads():
    r = requests.get(LEADS_API_URL, headers={"Authorization": f"Bearer {ADMIN_SECRET}"}, timeout=20)
    r.raise_for_status()
    return r.json().get("leads", [])


def mark_status(pathname, status):
    r = requests.post(
        LEADS_API_URL,
        headers={"Authorization": f"Bearer {ADMIN_SECRET}", "Content-Type": "application/json"},
        json={"pathname": pathname, "status": status},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


def send_email(to_email, subject, body):
    msg = MIMEMultipart()
    msg["From"] = f"{FROM_NAME} <{SMTP_USER}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(SMTP_USER, to_email, msg.as_string())


def main():
    if not ADMIN_SECRET:
        print("ADMIN_SECRET not configured - skipping this run.")
        return
    if not SMTP_USER or not SMTP_PASS:
        print("SMTP_USER/SMTP_PASS not configured - skipping this run.")
        return

    try:
        leads = fetch_leads()
    except Exception as e:
        print(f"failed to fetch leads: {e}", file=sys.stderr)
        sys.exit(1)

    new_leads = [l for l in leads if l.get("status") == "new" and l.get("email")]
    print(f"fetched {len(leads)} leads total, {len(new_leads)} new")

    sent, failed = 0, 0
    for lead in new_leads:
        body = REPLY_TEMPLATE.format(
            first_name=first_name(lead.get("name")),
            message=(lead.get("message") or "").strip(),
            tier_label=TIER_LABELS.get(lead.get("tier"), TIER_LABELS["not_sure"]),
            from_name=FROM_NAME,
        )
        subject = "Re: your inquiry"
        try:
            send_email(lead["email"], subject, body)
            mark_status(lead["pathname"], "contacted")
            sent += 1
        except Exception as e:
            print(f"failed to contact {lead.get('email')}: {e}", file=sys.stderr)
            failed += 1

    print(f"contacted {sent} leads, {failed} failed")


if __name__ == "__main__":
    main()
