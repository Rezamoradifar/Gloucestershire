# Global design preview

This is the implemented landing-page design on top of the Vercel preparation in PR #2. Screenshots are captured from the locally built website, not image-generation mockups.

- Split hero with large Earth photograph, editorial typography and AI image card.
- Larger imagery and consistent cards for dropshipping, arbitrage and artificial intelligence.
- Opportunity explorer opens on the portable-projector example; all six workflow steps remain accessible.
- Refined Earth/AI composition, FAQ accordions, contact section and mobile navigation.
- Landing-page main/footer rules are explicitly scoped to avoid inheriting dashboard layout.

## Captures

- [Desktop, 1440px](global-desktop.jpg)
- [Mobile, 390px](global-mobile.jpg)
- [Business model](global-model.jpg)
- [AI and global signals](global-intelligence.jpg)

Section-only captures omit the sticky navigation so it does not obscure the section while the browser captures an element taller than its viewport.

## Checks completed

- TypeScript and Vite production build passed.
- Existing website tests: 5 passed.
- Browser checks at widths 320, 390, 768, 1024 and 1440px: no document horizontal overflow or clipped principal cards.
- Mobile navigation, workflow keyboard controls, next-step button, all 18 FAQs, privacy dialog and dashboard CTA checked in Chromium.
- No browser JavaScript exceptions during the checks.
- The preview API returned its explicit empty `not_configured` response.
- Machine-readable browser results are in [verification.json](verification.json).

## Release status

The Vercel connector still returns HTTP 403 for the intended workspace `rusekingdom-4810`. No deployment was created, and no new Vercel URL is available. This design does not activate live trading or change contract economics. Vercel should build this version from source with Root Directory `website`; the existing Ubuntu deployment archive has not been regenerated.
