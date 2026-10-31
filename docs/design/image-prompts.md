# README artwork provenance

Generated on 2026-10-31. The banner's device photograph came from the Antigravity CLI, and the community illustration from Codex CLI; details are under each image. Each image came from a single call, without retries. Two variants were generated for each slot and one of each was kept; the others are not in the repository.

The generated images illustrate the app's purpose. They do not supply Scripture or represent identifiable people, and they do not draw app UI. Wherever the app appears, in the banner's screens and the phone screenshots, it is a capture of the live app; see [Screenshots](#screenshots).

## Banner

Saved asset: [`../assets/readme-banner.jpg`](../assets/readme-banner.jpg) (1792×761)

The banner is a composite. Only the photograph of the laptop and phone is generated. Everything on the screens and all of the type is real.

- **Photograph:** made with the built-in `image-generator` subagent of the Antigravity CLI (`agy` 1.4.2), which reported Google Imagen 3. It returned 1376×768, with both displays in flat chroma green.
- **Screens:** in Chromium, the green was keyed out, each display's edges were fitted, and a real capture of the app was mapped onto each display in perspective.
  - The laptop shows the reader on Genesis 1, under a black strip that fills the notch area.
  - The phone shows the night-mode player on John 3:16, under a plain status-bar band beneath the Dynamic Island.
- **Type:** the title, the app's own description «قراءة واستماع، بالترتيب المعتاد أو الزمني» and "ChronosBible" are set in Noto Sans Arabic and Inter. The credit "Built on top of eBible.org OSS Bible" carries the [official eBible.org logo](https://ebible.org/icon/eBibleorglogo.svg), unaltered.
- **Output:** the photograph was cropped to 1376×584 and scaled by 1.3, and the result saved as a JPEG at quality 92.

Final prompt:

```text
Use case: product mockup for a wide website header banner, in the style of an Apple product advertisement. Landscape 21:9.
Primary request: a premium studio product photograph of a laptop and a smartphone together, both screens facing the camera, ready for screen replacement.
Scene/backdrop: a seamless warm ivory studio sweep (#f3efe6) with a very soft, even gradient and no visible horizon line or floor edge.
Subject: a thin silver MacBook Air, open at about 105 degrees, seen straight on from the front with the camera slightly above the keyboard; and an iPhone 16 Pro in desert titanium, standing upright on the floor in front of the laptop's right front corner, in portrait, its screen facing the camera, overlapping the laptop base a little.
Screens: each display shows only a perfectly flat, uniform pure chroma green (#00ff00), filling the whole visible display area edge to edge inside thin black bezels. The iPhone keeps its black Dynamic Island. No reflections, glare, gradients, wallpaper, interface, text or icons on either screen.
Composition/framing: the devices form one group in the left half of the frame. The group fills only the middle 62% of the frame's height, with even empty backdrop above and below it. The right 48% of the frame is empty backdrop for a headline added later. Nothing cropped.
Style/medium: photorealistic, crisp, high-end product photography, true-to-life materials and proportions.
Lighting/mood: large soft diffused light from the upper left, gentle natural contact shadows beneath both devices, calm and premium.
Color palette: warm ivory backdrop, silver aluminium, desert-titanium phone frame, black bezels, chroma green screens.
Constraints: no text, no logos (no Apple logo), no legible keyboard legends, no props, no plants, no people, no hands, no watermark.
```

## Community reading

Saved asset: [`../assets/community-reading.jpg`](../assets/community-reading.jpg) (2163×727), converted to JPEG at quality 92 with no other edits.

Made with Codex CLI 0.162.1, using the **built-in image generation tool** through the **imagegen skill**. No fallback CLI or API-key workflow was used.

Final prompt:

```text
Use case: illustration-story
Asset type: supporting GitHub README illustration, 3:1 landscape (about 2164×727 px), for a section titled "Made for daily reading together"
Primary request: a quiet scene of three Egyptian church youth (young adults) sharing their daily Bible reading in the early evening. One follows along on a smartphone with earbuds in, listening. One reads from a paper Bible. One leans in to show a friend a passage on a phone.
Scene/backdrop: a shaded church courtyard at golden hour, with a low stone wall, an olive tree and a few plain chairs; ample negative space. No recognisable church building.
Style/medium: fine pen-and-ink lines with soft watercolor washes on warm ivory paper, like a plate in a beautifully printed book. Natural, varied faces; modest contemporary clothing.
Composition/framing: wide. The group sits close together, slightly off-centre, with breathing room on both sides. Faces in profile and three-quarter view, absorbed in the reading rather than smiling at the viewer.
Lighting/mood: warm late-afternoon light; focused and welcoming.
Color palette: ivory, muted olive green (#4d633f), sage, sand, soft terracotta, dark green-black ink (#29352d), a touch of burnished gold.
Constraints: no readable text anywhere (phone screens and book pages show only soft, unreadable lines), no app interface details, no logos, no watermark, no likeness of real people, no halos or glow. Opaque background.
```

## Screenshots

The app is never generated. Every view of it was captured on 2026-10-31 from <https://chronosbible.com/> in Google Chrome, driven by Playwright, as a fresh visitor with no saved progress, in the Africa/Cairo time zone.

The README's three phone screenshots use a 390×844 mobile viewport at 3×, with touch:

- [`../assets/mobile-reader.png`](../assets/mobile-reader.png): the landing page, Genesis 1.
- [`../assets/mobile-menu.png`](../assets/mobile-menu.png): the same page with the menu open.
- [`../assets/mobile-listening.png`](../assets/mobile-listening.png): the New Testament chronological reading `jhn-2-12`, switched to «ليلي» in the reading settings. Listen was tapped, then the player's next-verse button, until John 3:16 was the highlighted verse.

The only change to these captures is presentation: rounded corners and a hairline border, added in Chromium.

The banner's screens were captured the same way, sized to leave room for the bands added above them:

- **Laptop:** the landing page at a 1470×919 desktop viewport at 2×.
- **Phone:** the John 3:16 player at 390×790 at 3×.
