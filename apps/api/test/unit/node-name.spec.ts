import { describe, expect, it } from 'vitest';
import { NodeName } from '../../src/domain/node-name';
import { DomainError } from '../../src/domain/errors';

// §6.3 structural rules — name validation.
describe('NodeName (§6.3)', () => {
  it('trims surrounding whitespace', () => {
    expect(NodeName.create('  Financials  ').value).toBe('Financials');
  });

  it('NFC-normalizes so visually identical names collide', () => {
    // "é" as e + combining acute vs precomposed
    const decomposed = NodeName.create('Caf\u0065\u0301'); // e + combining acute
    const precomposed = NodeName.create('Caf\u00e9'); // precomposed é
    expect(decomposed.value).toBe(precomposed.value);
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(() => NodeName.create('')).toThrow(DomainError);
    expect(() => NodeName.create('   ')).toThrow(DomainError);
  });

  it('rejects "." and ".."', () => {
    expect(() => NodeName.create('.')).toThrow(DomainError);
    expect(() => NodeName.create('..')).toThrow(DomainError);
  });

  it('rejects "/" and control characters', () => {
    expect(() => NodeName.create('02/Financials')).toThrow(DomainError);
    expect(() => NodeName.create('bad\u0000name')).toThrow(DomainError);
  });

  it('rejects names longer than 255 characters after trim', () => {
    expect(() => NodeName.create('a'.repeat(256))).toThrow(DomainError);
    expect(NodeName.create('a'.repeat(255)).value).toHaveLength(255);
  });

  it('raises VALIDATION_FAILED as the domain error code', () => {
    try {
      NodeName.create('');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as DomainError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('splits stem and extension for files only', () => {
    expect(NodeName.create('QoE_Report_v3.pdf').split('FILE')).toEqual({
      stem: 'QoE_Report_v3',
      ext: '.pdf',
    });
    // A folder has no extension even when its name contains a dot.
    expect(NodeName.create('FY2025.Draft').split('FOLDER')).toEqual({
      stem: 'FY2025.Draft',
      ext: '',
    });
    // A leading dot is not an extension.
    expect(NodeName.create('.gitignore').split('FILE')).toEqual({
      stem: '.gitignore',
      ext: '',
    });
  });
});
