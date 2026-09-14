import { readFileSync } from 'node:fs';

import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/pattern-comparison.json', import.meta.url), 'utf8'),
) as {
  questions: Array<{
    id: string;
    expectedFaqId: string;
    expectedCategory: string;
    expectedSourcePath: string;
    expectedSourceUri: string;
  }>;
};
const schema = JSON.parse(
  readFileSync(new URL('../fixtures/pattern-comparison.schema.json', import.meta.url), 'utf8'),
);

describe('pattern comparison fixture', () => {
  it('matches its JSON Schema', () => {
    const validate = new Ajv({ allErrors: true }).compile(schema);

    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });

  it('contains ten unique questions covering all FAQ categories', () => {
    expect(new Set(fixture.questions.map(({ id }) => id)).size).toBe(10);
    expect(new Set(fixture.questions.map(({ expectedFaqId }) => expectedFaqId)).size).toBe(10);
    expect(new Set(fixture.questions.map(({ expectedCategory }) => expectedCategory)).size).toBe(8);
  });

  it('derives each citation URI from the declared repository path', () => {
    for (const question of fixture.questions) {
      expect(question.expectedSourceUri).toBe(
        `https://github.com/matakaha/rubberduckexpress/blob/main/${question.expectedSourcePath}`,
      );
    }
  });
});
