# design/ — the visual system

This bundle is the source of truth for **how the product looks**: tokens, typography, colour, spacing, shape, and component anatomy. `tokens/*.css` is inlined into the worker's stylesheet; the guideline cards are the reference sheets.

## What lives here, and what does not

| | Lives here | Lives elsewhere |
|---|---|---|
| Colour, type, spacing, shape, radius, control sizes | `tokens/*.css` | |
| Component anatomy: stamp, receipt table, inputs, buttons | `guidelines/*.html` | |
| Product copy and voice | | `docs/design.md` §2, §2½ |
| Worked figures, rates, bands, dollar amounts | | `docs/design.md` §2¾ canon, which is engine output |
| The math itself | | `src/finance/` |

**The bundle carries no copy authority and no arithmetic authority.** A figure printed on a card here is an illustration of a layout, and it must be canon or a visibly neutral placeholder (`M.MM%`, `n=NN`). Never a plausible-looking invented number: somebody will copy it into an ad.

## Re-exporting from the Claude Design app

The app is a drafting tool. The repo is the source of truth. Anything re-exported merges through this gate:

```
node design/_sweep-from-canon.mjs      # rebuild worked figures from canon
pnpm test tests/design-canon.test.ts   # fails if a retired figure came back
```

## Why the gate exists

The first bundle shipped carrying figures canon had already retired: `$2,347` (the cost against the *quoted* price, presented as the cost against the *cash* price), `$86,847`, `7.9%` against a `6.5%` reference, a `$75,000 to $100,000` band that is not on the AgDirect card, and "rate cards stop at 72 months" when the card runs to 84. It also contained a stale second copy of `design.md`.

None of that was careless. It is what happens when the same numbers are maintained in two places. So now they are maintained in one, and a test enforces it.

## Two standing conflicts, resolved design.md's way

1. `tokens/typography.css` opens with a Google Fonts `@import`. **The worker does not use it.** `docs/design.md` §4 requires subset woff2 served from our own origin, §9 forbids the third-party request, and the no-cookie-banner stance only holds while nothing leaves the page. Fonts are self-hosted in `public/fonts/`.
2. Peer statistics on any card are placeholders, not canon. No pile exists yet, the peer row does not render below n=20, and it always prints its own n.
