// The one public page, server-rendered as a string (spec.md Decision 2: no
// client framework, the form works as a plain POST, the photo path is the only
// JS). Everything here is design.md law: the paper/ink palette from section 3,
// Libre Franklin and Courier Prime from section 4, one 640px column from
// section 5, the wordmark from section 7.
//
// Placeholder body only. The form, the confirm screen and the ticket are
// session 2, and the engine output they render is computed in src/finance/.

const styles = `
@font-face {
  font-family: 'Libre Franklin';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/libre-franklin-latin-400-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'Libre Franklin';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/libre-franklin-latin-700-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'Libre Franklin';
  font-style: normal;
  font-weight: 900;
  font-display: swap;
  src: url('/fonts/libre-franklin-latin-900-normal.woff2') format('woff2');
}
/* Declared, not preloaded: nothing on this page sets a number yet, so the
   browser never fetches it. The ticket in session 2 preloads it. */
@font-face {
  font-family: 'Courier Prime';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/courier-prime-latin-400-normal.woff2') format('woff2');
}

:root {
  --paper: #F7F5EF;
  --ink: #191813;
  --ink-soft: #57534A;
  --rule: #D8D4C8;
  --denim: #2F5D8A;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: 'Libre Franklin', 'Franklin Gothic Medium', 'Segoe UI', Arial, sans-serif;
  font-size: 18px;
  line-height: 1.5;
}

main {
  max-width: 640px;
  margin: 0 auto;
  padding: 32px 16px 48px;
}

.wordmark {
  font-weight: 900;
  font-size: 28px;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  margin: 0;
}

.wordmark-rule {
  border: 0;
  border-top: 1px solid var(--rule);
  margin: 8px 0 4px;
}

.tagline {
  font-size: 14px;
  color: var(--ink-soft);
  margin: 0 0 48px;
}

h1 {
  font-weight: 700;
  font-size: 28px;
  line-height: 1.3;
  margin: 0 0 24px;
}

p { margin: 0 0 16px; }

.note { color: var(--ink-soft); font-size: 14px; }

a { color: var(--denim); }
`;

export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LoanHank</title>
<meta name="description" content="A free tool that reads a farm-equipment dealer quote and shows the real rate.">
<link rel="preload" as="font" type="font/woff2" href="/fonts/libre-franklin-latin-900-normal.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="/fonts/libre-franklin-latin-400-normal.woff2" crossorigin>
<style>${styles}</style>
</head>
<body>
<main>
  <p class="wordmark">LoanHank</p>
  <hr class="wordmark-rule">
  <p class="tagline">Runs the numbers. Takes no side.</p>

  <h1>Point your phone at the dealer's quote. See the number they didn't print.</h1>

  <p>The decoder is not open yet. When it is, you type four numbers off the paper you were handed, or take a photo of it, and it shows what the financing actually costs against paying cash.</p>

  <p class="note">Free, and it stays free.</p>
</main>
</body>
</html>
`;
}
