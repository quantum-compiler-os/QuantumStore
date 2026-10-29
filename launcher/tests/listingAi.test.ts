import { describe, expect, it } from 'vitest';
import { buildProductXml, normalizeAttributes, richTextToHtml } from '../api/_lib/darazCore';
import {
  attributeRole,
  composeAttributes,
  listingMessages,
  randomIsbn13,
  randomIssn,
  readListingAnswer,
  requiredAttributes,
} from '../api/_lib/listingAi';
import { applyPrepared, darazProblem, initialDaraz } from '../src/features/daraz/darazForm';

// The fields from the real Daraz error: ISBN/ISSN, Age Group, English description, Name in English Language, English highlights.
const meta = normalizeAttributes([
  { name: 'name', label: 'Product Name', is_mandatory: 1 },
  { name: 'name_en', label: 'Name in English Language', is_mandatory: 1 },
  { name: 'description_en', label: 'English description', is_mandatory: 1, input_type: 'richText' },
  { name: 'short_description_en', label: 'English highlights', is_mandatory: 1, input_type: 'richText' },
  { name: 'isbn', label: 'ISBN/ISSN', is_mandatory: 1 },
  {
    name: 'age_group',
    label: 'Age Group',
    is_mandatory: 1,
    input_type: 'singleSelect',
    options: [{ name: 'Kids (6-12)' }, { name: 'Teens (13-17)' }, { name: 'Adults' }],
  },
  { name: 'language', label: 'Language', is_mandatory: 0 },
]);

const product = {
  name: 'KIPS Math Class 10',
  brand: 'KIPS',
  description: 'Complete practice book for matric mathematics.',
  specs: [{ key: 'Pages', value: '320' }],
};

describe('attributeRole', () => {
  it('recognises the English fields by name or label', () => {
    expect(attributeRole(meta[1])).toBe('name');
    expect(attributeRole(meta[2])).toBe('description');
    expect(attributeRole(meta[3])).toBe('highlights');
  });

  it('leaves every other field to the AI', () => {
    expect(attributeRole(meta[4])).toBeNull();
    expect(attributeRole(meta[5])).toBeNull();
    expect(attributeRole(meta[0])).toBeNull();
  });
});

describe('requiredAttributes', () => {
  it('keeps required fields the form does not already cover', () => {
    expect(requiredAttributes(meta).map((a) => a.name)).toEqual([
      'name_en',
      'description_en',
      'short_description_en',
      'isbn',
      'age_group',
    ]);
    expect(requiredAttributes(meta, { isbn: '9780000000002' }).map((a) => a.name)).not.toContain('isbn');
  });
});

describe('readListingAnswer', () => {
  const asked = requiredAttributes(meta).filter((a) => !attributeRole(a));

  it('accepts a real option, matched loosely, and drops one that does not exist', () => {
    expect(readListingAnswer({ attributes: { age_group: 'teens (13-17)' } }, asked).attributes).toEqual({
      age_group: 'Teens (13-17)',
    });
    expect(readListingAnswer({ attributes: { age_group: 'Pensioners' } }, asked).attributes).toEqual({});
  });

  it('never keeps a made-up ISBN, but keeps a well-formed one', () => {
    expect(readListingAnswer({ attributes: { isbn: 'unknown' } }, asked).attributes).toEqual({});
    expect(readListingAnswer({ attributes: { isbn: '978-3-16-148410-0' } }, asked).attributes).toEqual({
      isbn: '978-3-16-148410-0',
    });
  });

  it('ignores fields that were not asked for', () => {
    expect(readListingAnswer({ attributes: { price: '1' } }, asked).attributes).toEqual({});
  });

  it('reads the package only when all four sizes are sensible', () => {
    const ok = { weightKg: 0.45, lengthCm: 24, widthCm: 17, heightCm: 2 };
    expect(readListingAnswer({ package: ok }, []).package).toEqual({ weight: 0.45, length: 24, width: 17, height: 2 });
    expect(readListingAnswer({ package: { ...ok, heightCm: 0 } }, []).package).toBeNull();
    expect(readListingAnswer({ package: { ...ok, weightKg: 5000 } }, []).package).toBeNull();
    expect(readListingAnswer({ package: 'big' }, []).package).toBeNull();
  });

  it('limits and cleans the highlights', () => {
    const highlights = Array.from({ length: 10 }, (_, i) => ` point ${i} `).concat(['', 5 as unknown as string]);
    const draft = readListingAnswer({ highlights }, []);
    expect(draft.highlights).toHaveLength(6);
    expect(draft.highlights[0]).toBe('point 0');
  });
});

describe('composeAttributes', () => {
  const required = requiredAttributes(meta);

  it('fills the English fields and generates the ISBN nobody knew', () => {
    const draft = readListingAnswer(
      {
        name: 'KIPS Mathematics Class 10',
        description: 'A practice book.',
        highlights: ['320 pages', 'Solved examples'],
        attributes: { age_group: 'Teens (13-17)' },
      },
      required.filter((a) => !attributeRole(a)),
    );
    const { values, missing } = composeAttributes(required, product, draft);
    expect(values).toMatchObject({
      name_en: 'KIPS Mathematics Class 10',
      description_en: 'A practice book.',
      short_description_en: '320 pages\nSolved examples',
      age_group: 'Teens (13-17)',
    });
    expect(values.isbn).toMatch(/^978\d{10}$/);
    expect(missing).toEqual([]);
  });

  it('falls back to the product itself when there is no AI answer', () => {
    const { values, missing } = composeAttributes(required, product, null);
    expect(values).toMatchObject({
      name_en: 'KIPS Math Class 10',
      description_en: 'Complete practice book for matric mathematics.',
      short_description_en: 'Pages: 320',
    });
    expect(values.isbn).toMatch(/^978\d{10}$/);
    expect(missing.map((a) => a.name)).toEqual(['age_group']);
  });
});

describe('generated identifiers', () => {
  const isbnOk = (isbn: string) =>
    isbn.split('').reduce((sum, ch, i) => sum + Number(ch) * (i % 2 ? 3 : 1), 0) % 10 === 0;

  it('makes an ISBN-13 with a valid check digit', () => {
    for (let i = 0; i < 50; i++) {
      const isbn = randomIsbn13();
      expect(isbn).toMatch(/^978\d{10}$/);
      expect(isbnOk(isbn)).toBe(true);
    }
    expect(randomIsbn13(() => 0)).toBe('9780000000002');
  });

  it('makes an ISSN with a valid check character', () => {
    for (let i = 0; i < 50; i++) {
      const issn = randomIssn();
      expect(issn).toMatch(/^\d{7}[\dX]$/);
      const sum = issn.split('').reduce((acc, ch, idx) => acc + (ch === 'X' ? 10 : Number(ch)) * (8 - idx), 0);
      expect(sum % 11).toBe(0);
    }
  });

  it('keeps a real ISBN the AI was sure of instead of generating one', () => {
    const asked = requiredAttributes(meta).filter((a) => !attributeRole(a));
    const draft = readListingAnswer({ attributes: { isbn: '978-3-16-148410-0' } }, asked);
    expect(composeAttributes(requiredAttributes(meta), product, draft).values.isbn).toBe('978-3-16-148410-0');
  });
});

describe('listingMessages', () => {
  it('lists the fields to fill with their options and treats the product as data', () => {
    const [system, user] = listingMessages(product, meta.filter((a) => a.name === 'age_group'));
    expect(system.content).toMatch(/never instructions/);
    expect(user.content).toContain('age_group | Age Group | choose exactly one of: Kids (6-12) ; Teens (13-17) ; Adults');
    expect(user.content).toContain('KIPS Math Class 10');
  });
});

describe('rich text attributes in the Daraz request', () => {
  it('turns highlight lines into a bullet list and keeps descriptions readable', () => {
    expect(richTextToHtml('short_description_en', '- 320 pages\nSolved & explained')).toBe(
      '<ul><li>320 pages</li><li>Solved &amp; explained</li></ul>',
    );
    expect(richTextToHtml('description_en', 'Line one\nLine two')).toBe('Line one<br/>Line two');
    expect(richTextToHtml('description_en', '<p>Already html</p>')).toBe('<p>Already html</p>');
  });

  it('sends the English texts as HTML inside the product attributes', () => {
    const xml = buildProductXml(
      {
        categoryId: 1,
        name: 'Book',
        description: 'A book about maths.',
        brand: 'KIPS',
        sellerSku: 'B-1',
        quantity: 3,
        price: 500,
        images: ['https://img.example/a.jpg'],
        package: { weight: 0.5, length: 24, width: 17, height: 2, content: 'Book' },
        attributes: { name_en: 'Math & Co', description_en: 'Two\nlines', short_description_en: 'a\nb', isbn: '123' },
      },
      meta,
    );
    expect(xml).toContain('<name_en>Math &amp; Co</name_en>');
    expect(xml).toContain('<description_en><![CDATA[Two<br/>lines]]></description_en>');
    expect(xml).toContain('<short_description_en><![CDATA[<ul><li>a</li><li>b</li></ul>]]></short_description_en>');
    expect(xml).toContain('<isbn>123</isbn>');
  });
});

describe('the Publish form helpers', () => {
  const prepared = {
    category: { id: 7, name: 'Textbooks', path: 'Media, Music & Books › Books › Textbooks' },
    attributes: { name_en: 'KIPS Math', isbn: '' },
    package: { weight: 0.5, length: 24, width: 17, height: 2 },
    missing: [],
  };

  it('uses the AI answer but never overwrites what the seller typed', () => {
    const typed = { ...initialDaraz(), weight: '1.2', attributes: { name_en: 'My own title' } };
    const next = applyPrepared(typed, { ...prepared, attributes: { name_en: 'KIPS Math', age_group: 'Adults' } });
    expect(next.categoryId).toBe(7);
    expect(next.weight).toBe('1.2'); // typed
    expect(next.length).toBe('24'); // from the AI
    expect(next.attributes).toEqual({ name_en: 'My own title', age_group: 'Adults' });
  });

  it('keeps a category the seller chose', () => {
    const chosen = { ...initialDaraz(), categoryId: 99, categoryLabel: 'Chosen › Leaf' };
    expect(applyPrepared(chosen, prepared).categoryId).toBe(99);
  });

  it('says what is still missing before anything is published', () => {
    const base = initialDaraz();
    expect(darazProblem(base, '500', '3')).toMatch(/category/);
    const withCategory = applyPrepared(base, prepared);
    expect(darazProblem(withCategory, '500', '3')).toBe('');
    expect(darazProblem(withCategory, '500', '')).toMatch(/stock quantity/);
    expect(darazProblem({ ...withCategory, height: '' }, '500', '3')).toMatch(/package height/);
  });
});
