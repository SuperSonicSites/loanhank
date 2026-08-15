// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { Field, Icon, Mascot, ProvenanceBadge, Sheet } from '../../standalone/src/app/components.js';

afterEach(cleanup);

/** A realistic host: a trigger button that opens the sheet and must regain focus. */
function Host({ dismissible = true }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open the sheet</button>
      {open ? (
        <Sheet title="Test a scenario" onClose={() => setOpen(false)} dismissible={dismissible}>
          <Field label="Candidate rate">
            <input className="lh-input" defaultValue="6.85" />
          </Field>
          <button type="button">Run scenario</button>
        </Sheet>
      ) : null}
    </>
  );
}

describe('dialogs', () => {
  it('is a labelled modal dialog', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the sheet' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: 'Test a scenario' })).toBeTruthy();
  });

  it('moves focus into the dialog when it opens', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the sheet' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the sheet' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape even when the backdrop is not dismissible', () => {
    render(<Host dismissible={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the sheet' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('restores focus to whatever opened it', () => {
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Open the sheet' });
    // A real pointer or keyboard interaction focuses the trigger first; jsdom's
    // synthetic click does not, so focus it explicitly.
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('offers a labelled close control', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the sheet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Test a scenario' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps Tab inside the dialog in both directions', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the sheet' }));
    const dialog = screen.getByRole('dialog');
    const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary')];
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('locks background scrolling only while it is open', () => {
    render(<Host />);
    expect(document.body.classList.contains('lh-scroll-lock')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open the sheet' }));
    expect(document.body.classList.contains('lh-scroll-lock')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.classList.contains('lh-scroll-lock')).toBe(false);
  });
});

describe('component semantics', () => {
  it('labels a field and its control together', () => {
    render(<Field label="Current balance"><input className="lh-input" /></Field>);
    expect(screen.getByLabelText(/Current balance/)).toBeTruthy();
  });

  it('hides decorative icons from assistive technology and names meaningful ones', () => {
    const { container, rerender } = render(<Icon name="bell" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    rerender(<Icon name="bell" label="Watches" />);
    expect(screen.getByRole('img', { name: 'Watches' })).toBeTruthy();
  });

  it('treats the mascot as decoration unless it is given a description', () => {
    const { container } = render(<Mascot pose="clipboard" />);
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('announces what a provenance badge means beyond its colour', () => {
    render(<ProvenanceBadge kind="ESTIMATED" detail="Projected by deterministic math" />);
    expect(screen.getByText('Estimated')).toBeTruthy();
    expect(screen.getByText(/Projected by deterministic math/)).toBeTruthy();
  });

  it('gives every provenance kind a distinct visible label, not colour alone', () => {
    const kinds = ['KNOWN', 'ESTIMATED', 'SCENARIO', 'EXTERNAL_REFERENCE'] as const;
    const labels = kinds.map((kind) => {
      const { container, unmount } = render(<ProvenanceBadge kind={kind} />);
      const text = container.textContent ?? '';
      unmount();
      return text;
    });
    expect(new Set(labels).size).toBe(kinds.length);
  });
});

describe('stylesheet guarantees', () => {
  it('declares a 44px minimum target and honours reduced motion', async () => {
    const css = await readFile(path.resolve(process.cwd(), 'standalone/public/assets/loanhank.css'), 'utf8');
    const app = await readFile(path.resolve(process.cwd(), 'standalone/src/styles/app.css'), 'utf8');
    expect(css).toContain('--tap-min:44px');
    expect(css).toContain('prefers-reduced-motion');
    expect(app).toContain('prefers-reduced-motion');
    expect(css).toContain(':focus-visible');
  });

  it('serves every font from this origin', async () => {
    const css = await readFile(path.resolve(process.cwd(), 'standalone/public/assets/loanhank.css'), 'utf8');
    expect(css).not.toContain('@import url(');
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('fonts.gstatic.com');
    const sources = [...css.matchAll(/src:url\('([^']+)'\)/g)].map((match) => match[1]!);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) expect(source.startsWith('/fonts/')).toBe(true);
  });
});
