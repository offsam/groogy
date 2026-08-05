#!/usr/bin/env python3
"""Regression: enrich BFS must not chase CMS chrome / own-site blogrolls.

Run: python3 scripts/business-enrich/test_enrich_follow_policy.py
CI: .github/workflows/ci.yml
"""

from __future__ import annotations

import sys
import unittest
from collections import deque
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from enrich_follow_policy import (  # noqa: E402
    CMS_CHROME_HOST_PARTS,
    filter_related_websites_for_queue,
    is_cms_chrome_url,
    should_follow_related_websites,
)
from enrich_resource_queue import (  # noqa: E402
    can_be_own_website,
    enqueue_discovered,
    is_junk_url,
    run_resource_bfs,
)


EURODELI_BLOGROLL = [
    "http://gmpg.org/xfn/11",
    "http://tantek.com/",
    "http://photomatt.net/",
    "http://meyerweb.com/",
    "http://creativecommons.org/licenses/by-nd/2.0/",
    "https://github.com/w3c/csswg-drafts/issues/9706",
    "https://indieweb.org/Create_Day",
    "https://wordpress.org/",
    "https://eurodeli.us/menu",  # same brand-ish path — still related outbound
]


class EnrichFollowPolicyTests(unittest.TestCase):
    def test_cms_chrome_hosts_marked(self) -> None:
        self.assertTrue(is_cms_chrome_url("http://gmpg.org/xfn/11"))
        self.assertTrue(is_cms_chrome_url("https://creativecommons.org/licenses/by/4.0/"))
        self.assertTrue(is_cms_chrome_url("https://github.com/foo/bar"))
        self.assertTrue(is_cms_chrome_url("https://indieauth.com/auth"))
        self.assertFalse(is_cms_chrome_url("https://eurodeli.us/"))
        self.assertFalse(is_cms_chrome_url("https://vitaliia.framer.website/"))

    def test_junk_url_includes_cms_chrome(self) -> None:
        self.assertTrue(is_junk_url("http://gmpg.org/xfn/11"))
        self.assertTrue(is_junk_url("https://wordpress.org/plugins/"))
        self.assertFalse(is_junk_url("https://eurodeli.us/"))

    def test_own_website_never_follows_related(self) -> None:
        self.assertFalse(
            should_follow_related_websites(
                kind="website", page_url="https://eurodeli.us/"
            )
        )
        filtered = filter_related_websites_for_queue(
            EURODELI_BLOGROLL,
            kind="website",
            page_url="https://eurodeli.us/",
            can_be_own_website=can_be_own_website,
        )
        self.assertEqual(filtered, [])

    def test_instagram_never_follows_related(self) -> None:
        self.assertFalse(
            should_follow_related_websites(
                kind="instagram", page_url="https://instagram.com/lisayumm"
            )
        )

    def test_booking_saas_may_follow_related(self) -> None:
        self.assertTrue(
            should_follow_related_websites(
                kind="website",
                page_url="https://vitaliia.glossgenius.com/",
            )
        )
        # Blogroll still filtered by can_be_own / chrome; Framer-like survives.
        related = [
            "http://gmpg.org/xfn/11",
            "https://vitaliia.framer.website/",
            "https://tantek.com/",
        ]
        filtered = filter_related_websites_for_queue(
            related,
            kind="website",
            page_url="https://vitaliia.glossgenius.com/",
            can_be_own_website=can_be_own_website,
        )
        self.assertIn("https://vitaliia.framer.website/", filtered)
        self.assertNotIn("http://gmpg.org/xfn/11", filtered)
        self.assertNotIn("https://tantek.com/", filtered)

    def test_source_may_follow_related(self) -> None:
        # Non-directory source (e.g. pasted HTML / post) may still discover sites.
        self.assertTrue(
            should_follow_related_websites(
                kind="source", page_url="https://example-blog.example/post/123"
            )
        )

    def test_directory_never_follows_related(self) -> None:
        """ROP / Svoi WordPress sidebars must not enqueue other advertisers."""
        for url in (
            "https://www.russianorangepages.com/community/russian-services/medical-doctors/foo/",
            "https://svoi.us/listing/123",
        ):
            self.assertFalse(
                should_follow_related_websites(kind="source", page_url=url),
                msg=url,
            )
            filtered = filter_related_websites_for_queue(
                [
                    "https://fchconstruction.org/",
                    "https://www.liveattheshell.org/",
                    "https://www.art-a-fair.com/",
                    "https://affordabledentist.us/",
                ],
                kind="source",
                page_url=url,
                can_be_own_website=can_be_own_website,
            )
            self.assertEqual(filtered, [], msg=url)

    def test_civic_sidebar_cannot_be_own_website(self) -> None:
        for url in (
            "https://ocparks.com/",
            "https://themuck.org/",
            "https://fchconstruction.org/",
            "https://www.liveattheshell.org/",
            "https://www.art-a-fair.com/",
        ):
            self.assertFalse(can_be_own_website(url), msg=url)
        self.assertTrue(can_be_own_website("https://affordabledentist.us/"))

    def test_former_sidebar_advertiser_seed_still_mines(self) -> None:
        """Admin-set FCH is mined; sibling sidebar hosts must not cascade."""
        from enrich_resource_queue import run_resource_bfs

        calls: list[str] = []

        def mine(url: str, kind: str = "website", website_pages: int = 6):
            calls.append(url)
            if "russianorangepages.com" in url:
                return {"_status": "fetch_failed", "_error": "dns"}
            if "fchconstruction.org" in url:
                return {
                    "_status": "ok",
                    "phone": "323-555-0100",
                    "description": "FCH Construction remodel.",
                    # Poison: pretend the page linked the whole ROP sidebar.
                    "discovered_urls": [
                        "https://www.liveattheshell.org/",
                        "https://www.art-a-fair.com/",
                        "https://www.ocparks.com/news/x",
                        "https://www.instagram.com/fch_ok/",
                    ],
                    "social_links": [
                        "https://www.instagram.com/fch_ok/",
                    ],
                }
            return {"_status": "ok", "description": "should not mine"}

        out = run_resource_bfs(
            source_url="https://www.russianorangepages.com/community/x/",
            card_urls=[
                "https://www.fchconstruction.org/",
                "https://www.liveattheshell.org/",
                "https://www.art-a-fair.com/",
            ],
            max_resources=12,
            sequential=True,
            mine_fn=mine,
            preferred_website="https://www.fchconstruction.org/",
        )
        mined_hosts = " ".join(calls)
        self.assertIn("fchconstruction.org", mined_hosts)
        self.assertNotIn("liveattheshell", mined_hosts)
        self.assertNotIn("art-a-fair", mined_hosts)
        self.assertNotIn("ocparks", mined_hosts)
        kinds = [s["kind"] for s in out["steps"]]
        self.assertEqual(kinds[0], "source")
        self.assertEqual(kinds[1], "website")
        # Own IG from the seed site is OK; foreign websites are not.
        self.assertTrue(all(k in ("source", "website", "instagram") for k in kinds))

    def test_enqueue_drops_cms_chrome(self) -> None:
        q: deque[str] = deque()
        visited: set[str] = set()
        queued: set[str] = set()
        added = enqueue_discovered(
            q,
            visited,
            queued,
            [
                "http://gmpg.org/xfn/11",
                "https://creativecommons.org/licenses/by-nd/2.0/",
                "https://github.com/w3c/csswg-drafts/issues/9706",
                "https://eurodeli.us",
                "https://instagram.com/lisayumm",
            ],
        )
        self.assertEqual(
            set(added),
            {"https://eurodeli.us", "https://instagram.com/lisayumm"},
        )

    def test_cms_chrome_list_nonempty(self) -> None:
        self.assertGreaterEqual(len(CMS_CHROME_HOST_PARTS), 10)
        self.assertIn("gmpg.org", CMS_CHROME_HOST_PARTS)

    def test_source_dns_fail_still_mines_card_website(self) -> None:
        """ROP/DNS death must not skip the card's own site."""
        calls: list[tuple[str, str]] = []

        def mine(url: str, kind: str = "website", website_pages: int = 6):
            calls.append((url, kind))
            if "russianorangepages.com" in url:
                return {
                    "_status": "fetch_failed",
                    "_error": "urlopen error [Errno 8] nodename nor servname",
                }
            return {
                "_status": "ok",
                "description": "Handyman and remodel in Orange County.",
                "phone": "949-555-0100",
            }

        out = run_resource_bfs(
            source_url=(
                "https://www.russianorangepages.com/community/"
                "russian-services/home-services/professional-handyman-services-new-ad/"
            ),
            card_urls=["https://alex-handyman.example.com/"],
            max_resources=8,
            sequential=True,
            mine_fn=mine,
        )
        kinds = [s["kind"] for s in out["steps"]]
        self.assertEqual(kinds, ["source", "website"])
        self.assertEqual(out["steps"][0]["outcome"], "error")
        self.assertEqual(out["steps"][1]["outcome"], "ok")
        self.assertEqual(out["found"].get("phone"), "949-555-0100")
        self.assertEqual(calls[1][1], "website")


    def test_preferred_website_drops_origin_sidebar_siblings(self) -> None:
        """Assanti card must not seed bike911 / homeopathy from origin glue."""
        from enrich_resource_queue import build_initial_queue

        _q, deferred = build_initial_queue(
            source_url=(
                "https://www.russianorangepages.com/community/"
                "russian-services/lawyers/a-g-assanti-associate-pc/"
            ),
            card_urls=[
                "https://assantilaw.com",
                "https://www.bike911.com",
                "https://lifespringhomeopathy.com",
                "http://www.rusoc.com",
                "https://www.documentheroes.com",
                "https://www.facebook.com/RusOCNews",
            ],
            sequential=True,
            preferred_website="https://assantilaw.com",
        )
        joined = " ".join(deferred)
        self.assertIn("assantilaw.com", joined)
        self.assertNotIn("bike911", joined)
        self.assertNotIn("lifespring", joined)
        self.assertNotIn("rusoc.com", joined)
        self.assertNotIn("documentheroes", joined)
        self.assertNotIn("RusOCNews", joined)


class SocialContactOnlyTests(unittest.TestCase):
    """Telegram / YouTube / Trustpilot are contacts — never deep-crawl chrome."""

    def test_telegram_channel_is_link_only(self) -> None:
        from enrich_resource_queue import classify_resource, mine_resource

        url = "https://t.me/startcdl"
        self.assertEqual(classify_resource(url), "telegram")
        out = mine_resource(url)
        self.assertEqual(out.get("_status"), "link_only")
        self.assertEqual(out.get("telegram_url"), url)
        self.assertEqual(out.get("discovered_urls") or [], [])

    def test_telegram_product_chrome_is_junk(self) -> None:
        chrome = [
            "https://t.me/faq",
            "https://t.me/img/favicon.ico",
            "https://t.me/css/bootstrap.min.css",
            "https://t.me/blog",
            "https://t.me/s/payments",
            "https://t.me/contact",
            "https://t.me/contact-us",
            "https://t.me/apps",
            "https://t.me/safety",
        ]
        for url in chrome:
            self.assertTrue(is_junk_url(url), url)

        q: deque[str] = deque()
        added = enqueue_discovered(q, set(), set(), chrome + ["https://t.me/startcdl"])
        self.assertEqual(added, ["https://t.me/startcdl"])

    def test_youtube_is_link_only_trustpilot_mines_url(self) -> None:
        from enrich_resource_queue import classify_resource, mine_resource

        yt = "https://www.youtube.com/channel/UCjYH6uOnInA7OOggwbX-lYQ"
        tp = "https://www.trustpilot.com/review/startcdl.com"
        self.assertEqual(classify_resource(yt), "youtube")
        self.assertEqual(classify_resource(tp), "trustpilot")

        yt_out = mine_resource(yt)
        self.assertEqual(yt_out.get("_status"), "link_only")
        self.assertEqual(yt_out.get("discovered_urls") or [], [])
        self.assertEqual(yt_out.get("youtube_url"), yt.split("?")[0][:300])

        tp_out = mine_resource(tp)
        # WAF often blocks body — still keep the review URL, never deep-crawl.
        self.assertEqual(
            tp_out.get("trustpilot_url"),
            "https://www.trustpilot.com/review/startcdl.com",
        )
        self.assertEqual(tp_out.get("discovered_urls") or [], [])
        self.assertIn(tp_out.get("_status"), ("blocked", "ok", "empty", "error"))


if __name__ == "__main__":
    raise SystemExit(0 if unittest.main(verbosity=2, exit=False).result.wasSuccessful() else 1)
