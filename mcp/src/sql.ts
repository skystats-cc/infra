/**
 * One statement only. psql sends a -c string as a single multi-statement query, so
 * "SELECT 1; COMMIT; INSERT ..." could leave the READ ONLY transaction. Reject any inner ";".
 */
export function singleStatement(query: string): string | null {
  const q = query.trim().replace(/;\s*$/, '');
  if (!q || q.includes(';')) return null;
  return q;
}
