import { describe, expect, it } from 'vitest';
import { suggestFreeName } from '../../src/domain/conflict-resolver';

// §6.2 suffixing (keep-both).
describe('suggestFreeName (§6.2)', () => {
  it('returns the desired name untouched when nothing collides', () => {
    expect(suggestFreeName('Report.pdf', new Set(['Other.pdf']), 'FILE')).toBe('Report.pdf');
  });

  it('inserts the suffix before the extension for files', () => {
    expect(suggestFreeName('Report.pdf', new Set(['Report.pdf']), 'FILE')).toBe('Report (1).pdf');
  });

  it('appends the suffix at the end for folders', () => {
    expect(suggestFreeName('FY2025', new Set(['FY2025']), 'FOLDER')).toBe('FY2025 (1)');
  });

  it('skips over already-taken suffixes', () => {
    const siblings = new Set(['Report.pdf', 'Report (1).pdf', 'Report (2).pdf']);
    expect(suggestFreeName('Report.pdf', siblings, 'FILE')).toBe('Report (3).pdf');
  });

  it('strips an existing " (k)" suffix before searching, so names do not compound', () => {
    const siblings = new Set(['Report.pdf', 'Report (1).pdf']);
    // "Report (1).pdf" must not become "Report (1) (1).pdf"
    expect(suggestFreeName('Report (1).pdf', siblings, 'FILE')).toBe('Report (2).pdf');
  });

  it('treats a dotted folder name as having no extension', () => {
    expect(suggestFreeName('FY2025.Draft', new Set(['FY2025.Draft']), 'FOLDER')).toBe(
      'FY2025.Draft (1)',
    );
  });

  it('uses only the last dot segment as the extension', () => {
    expect(suggestFreeName('archive.tar.gz', new Set(['archive.tar.gz']), 'FILE')).toBe(
      'archive.tar (1).gz',
    );
  });

  it('is pure — the sibling set is not mutated', () => {
    const siblings = new Set(['Report.pdf']);
    suggestFreeName('Report.pdf', siblings, 'FILE');
    expect([...siblings]).toEqual(['Report.pdf']);
  });

  it('is deterministic across repeated calls', () => {
    const siblings = new Set(['a.pdf', 'a (1).pdf']);
    const first = suggestFreeName('a.pdf', siblings, 'FILE');
    expect(suggestFreeName('a.pdf', siblings, 'FILE')).toBe(first);
  });
});
