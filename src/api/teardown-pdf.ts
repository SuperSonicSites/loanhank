import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

// THE TEARDOWN — the thing the farmer carries back to the dealer desk.
//
// design.md §9: the PDF mirrors the ticket exactly, black ink on white paper,
// same receipt rules, stamp included. It is a printout, not a brochure, and it
// is the best marketing this product will ever ship.
//
// TYPE, and a deviation worth knowing about. The screen sets numbers in
// Courier Prime and everything else in Libre Franklin. A PDF has to embed the
// faces it uses, and @fontsource ships woff2 and woff only, neither of which
// pdf-lib can embed. So this uses the PDF standard Courier for the receipt
// column, which is the face Courier Prime is a revival of and holds the same
// carbon-copy register, and Helvetica for labels and prose, which Libre
// Franklin is not. Shipping a TTF of Libre Franklin would close the gap.

const INK = rgb(0.098, 0.094, 0.075);      // --ink #191813
const INK_SOFT = rgb(0.341, 0.325, 0.290); // --ink-soft #57534A
const RULE = rgb(0.6, 0.6, 0.57);
const FIELD = rgb(0.247, 0.478, 0.204);    // --field #3F7A34
const AMBER = rgb(0.541, 0.353, 0.0);      // --amber-ink #8A5A00

const PAGE_WIDTH = 595.28;   // A4 portrait, because a farmer may be anywhere
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const COLUMN = PAGE_WIDTH - MARGIN * 2;

export interface TeardownLine {
  label: string;
  amount: string;
}

export interface TeardownInput {
  rate: string;
  rateLabel: string;
  verdict: 'checks_out' | 'look_closer' | 'none';
  verdictLine: string;
  lines: TeardownLine[];
  reference: string | null;
  assumption: string | null;
  missing: string[];
  footnote: string;
  postalAddress: string;
  generatedOn: string;
}

/** Greedy wrap. Enough for a receipt, and it keeps the module dependency-free. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) > width && current !== '') {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

export async function renderTeardownPdf(input: TeardownInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Your LoanHank teardown');
  pdf.setCreator('LoanHank');
  // A quote teardown carries no author and no keywords. Nothing about the
  // farmer goes into the file metadata.

  const page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const ui = await pdf.embedFont(StandardFonts.Helvetica);
  const uiBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const monoBold = await pdf.embedFont(StandardFonts.CourierBold);

  let y = PAGE_HEIGHT - MARGIN;

  const text = (value: string, font: PDFFont, size: number, color = INK, x = MARGIN) => {
    page.drawText(value, { x, y, size, font, color });
  };
  const rule = (thickness = 0.75, color = RULE) => {
    page.drawLine({
      start: { x: MARGIN, y }, end: { x: MARGIN + COLUMN, y },
      thickness, color,
    });
  };
  const paragraph = (value: string, font: PDFFont, size: number, color = INK, gap = 4) => {
    for (const line of wrap(value, font, size, COLUMN)) {
      y -= size + gap;
      text(line, font, size, color);
    }
  };

  // Wordmark, and the hairline under it.
  text('LOANHANK', uiBold, 18, INK);
  y -= 8;
  rule();
  y -= 12;
  text('Runs the numbers. Takes no side.', ui, 9, INK_SOFT);

  // The headline rate.
  y -= 36;
  text(input.rateLabel.toUpperCase(), mono, 9, INK_SOFT);
  y -= 34;
  text(input.rate, monoBold, 34, INK);

  // The stamp, if one was earned. Drawn as a real box, not a texture: a
  // pristine vector distressed edge is fake antique, worse than nothing.
  if (input.verdict !== 'none') {
    const label = input.verdict === 'checks_out' ? 'CHECKS OUT' : 'LOOK CLOSER';
    const color = input.verdict === 'checks_out' ? FIELD : AMBER;
    const width = monoBold.widthOfTextAtSize(label, 14) + 20;
    y -= 30;
    page.drawRectangle({
      x: MARGIN, y: y - 5, width, height: 24,
      borderColor: color, borderWidth: 2,
    });
    page.drawText(label, { x: MARGIN + 10, y: y + 2, size: 14, font: monoBold, color });
  }

  y -= 26;
  paragraph(input.verdictLine, uiBold, 12, INK, 3);

  // The receipt. Labels left, values right, hairline between every line.
  y -= 18;
  rule(1, INK);
  for (const line of input.lines) {
    y -= 18;
    text(line.label, ui, 10, INK);
    const width = mono.widthOfTextAtSize(line.amount, 10);
    page.drawText(line.amount, {
      x: MARGIN + COLUMN - width, y, size: 10, font: mono, color: INK,
    });
    y -= 6;
    rule();
  }

  // Double rule above the total, the way a receipt does it.
  y -= 3;
  rule(1, INK);

  if (input.reference !== null) {
    y -= 8;
    paragraph(input.reference, mono, 9, INK, 3);
  }

  if (input.assumption !== null) {
    y -= 10;
    paragraph(input.assumption, ui, 9, AMBER, 3);
  }

  if (input.missing.length > 0) {
    y -= 16;
    text("No verdict yet. Here's what's missing.", uiBold, 11, INK);
    for (const item of input.missing) {
      y -= 6;
      paragraph(`- ${item}`, ui, 9, INK, 3);
    }
  }

  // Footnotes and the CAN-SPAM footer live at the bottom of the sheet.
  let footY = MARGIN + 52;
  const footnote = (value: string, size = 8) => {
    for (const line of wrap(value, ui, size, COLUMN)) {
      page.drawText(line, { x: MARGIN, y: footY, size, font: ui, color: INK_SOFT });
      footY -= size + 3;
    }
  };
  page.drawLine({
    start: { x: MARGIN, y: footY + 14 }, end: { x: MARGIN + COLUMN, y: footY + 14 },
    thickness: 0.75, color: RULE,
  });
  footnote(input.footnote);
  footnote(`Run on ${input.generatedOn}. LoanHank, ${input.postalAddress}`);

  return pdf.save();
}
