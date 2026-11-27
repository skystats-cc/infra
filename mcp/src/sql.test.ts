import { describe, expect, it } from 'vitest';
import { singleStatement } from './sql.js';

describe('singleStatement', () => {
  it('allows one statement, with or without a trailing semicolon', () => {
    expect(singleStatement('select 1')).toBe('select 1');
    expect(singleStatement('  select count(*) from players;  ')).toBe('select count(*) from players');
  });
  it('rejects multiple statements', () => {
    expect(singleStatement('select 1; commit; insert into players values (1)')).toBeNull();
    expect(singleStatement('commit;insert into x values (1);')).toBeNull();
    expect(singleStatement(';')).toBeNull();
  });
});
