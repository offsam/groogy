"""Keep in sync with lib/admin/website-assets.test.ts."""

from __future__ import annotations

import unittest

from website_assets import (
    canonical_media_url,
    classify_site_image,
    extract_image_urls_from_html,
    linked_content_paths,
    looks_like_logo_url,
    pick_site_media,
    photo_from_website_profile,
)

LOGO = "https://static.wixstatic.com/media/534338_5e62fcdab6c341799d8cb75ed7a1ba16~mv2.png/v1/fill/w_254,h_246,al_c,q_85/LOGO.png"
CERT = "https://static.wixstatic.com/media/534338_95cae00e765e4a218ca3d50087b76ab9~mv2_d_4915_3188_s_4_2.jpg/v1/fill/w_1346,h_858,al_c,q_85/FINAL%20CERT.jpg"
CERT2 = "https://static.wixstatic.com/media/534338_5c3144c1ff894a24a07eb41512ad4142~mv2.jpg/v1/fill/w_1124,h_858,al_c,q_85/WTI%20Immig%20Law%20Spec%20Cert_edited.jpg"
PORTRAIT = "https://static.wixstatic.com/media/534338_f9e132cdf354442b9b596570fc7d5377~mv2.jpg/v1/crop/x_305,y_0,w_1415,h_2048/fill/w_636,h_918,al_c,q_85/photo.jpg"


class WebsiteAssetsTest(unittest.TestCase):
    def test_canonical_strips_wix_fill(self) -> None:
        self.assertEqual(
            canonical_media_url(LOGO),
            "https://static.wixstatic.com/media/534338_5e62fcdab6c341799d8cb75ed7a1ba16~mv2.png",
        )

    def test_kinds(self) -> None:
        self.assertEqual(classify_site_image(LOGO)["kind"], "logo")
        self.assertEqual(classify_site_image(CERT)["kind"], "certificate")
        self.assertEqual(classify_site_image(CERT2)["kind"], "certificate")
        self.assertEqual(classify_site_image(PORTRAIT)["kind"], "portrait")
        self.assertTrue(looks_like_logo_url(LOGO))

    def test_pick_skips_logo(self) -> None:
        pick = pick_site_media([LOGO, CERT, CERT2, PORTRAIT])
        self.assertNotEqual(pick["portrait"], canonical_media_url(LOGO))
        self.assertGreaterEqual(len(pick["certificates"]), 2)

    def test_linked_paths_not_invented(self) -> None:
        html = (
            '<a href="/about">About</a>'
            '<a href="https://www.translatorpro.org/contact">Contact</a>'
            f'<img src="{LOGO}" />'
        )
        links = linked_content_paths(html, "https://www.translatorpro.org/")
        self.assertIn("/about", links)
        self.assertIn("/contact", links)
        self.assertNotIn("/menu", links)

    def test_logo_cover_is_replaceable(self) -> None:
        from website_assets import should_replace_cover

        self.assertTrue(should_replace_cover(LOGO))
        self.assertTrue(should_replace_cover(""))
        self.assertFalse(should_replace_cover(PORTRAIT))

    def test_skip_fill_fragments(self) -> None:
        bogus = extract_image_urls_from_html(
            'src="quality_auto/FINAL%20CERT.jpg"',
            "https://www.translatorpro.org/",
        )
        self.assertFalse(any("translatorpro.org/quality_auto" in u for u in bogus))

    def test_photo_from_profile_skips_logo(self) -> None:
        portrait, certs = photo_from_website_profile(
            {"logo": LOGO, "image_url": canonical_media_url(PORTRAIT), "gallery_urls": [CERT]}
        )
        self.assertTrue(portrait and "f9e132cd" in portrait)
        self.assertEqual(len(certs), 1)


if __name__ == "__main__":
    unittest.main()
