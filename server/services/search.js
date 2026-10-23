// Repository Search (UC-015/UC-016, FR h, Lab 7 IRepositorySearch.searchTheses)
import { one, all } from '../db/database.js';
import { fail } from '../errors.js';

const STAFF = ['admin', 'librarian', 'institute'];

// Who may open the PDF of a published thesis. Restricted theses expose metadata only.
export function canDownloadPublished(user, t, visibility) {
  if (visibility === 'Public') return true;
  if (!user) return false;
  return STAFF.includes(user.role) || t.author_id === user.id || t.guide_id === user.id || t.examiner_id === user.id;
}

// Turns free text into a safe FTS5 query: every term quoted, last term prefix-matched.
function ftsQuery(q) {
  const terms = q.match(/[\p{L}\p{N}]+/gu) || [];
  if (!terms.length) return null;
  return terms.slice(0, 12).map((t, i, a) => `"${t}"${i === a.length - 1 ? '*' : ''}`).join(' ');
}

export function searchTheses(user, query) {
  const { q = '', department, degree, keyword, author } = query;
  const yearFrom = query.yearFrom ? Number(query.yearFrom) : null;
  const yearTo = query.yearTo ? Number(query.yearTo) : null;
  if ((yearFrom && !Number.isInteger(yearFrom)) || (yearTo && !Number.isInteger(yearTo))) fail('INVALID_FILTER', 'Year filters must be whole numbers.', 422);
  if (yearFrom && yearTo && yearFrom > yearTo) fail('INVALID_FILTER', '"From" year must not be after "To" year.', 422);
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = 10;

  const where = [`t.status = 'Published'`];
  const params = [];
  if (!user) where.push(`c.visibility = 'Public'`);
  if (department) { where.push('t.department_id = ?'); params.push(Number(department)); }
  if (degree) { where.push('t.degree = ?'); params.push(degree); }
  if (yearFrom) { where.push('t.year >= ?'); params.push(yearFrom); }
  if (yearTo) { where.push('t.year <= ?'); params.push(yearTo); }
  if (keyword) { where.push(`(', ' || lower(t.keywords) || ',') LIKE ?`); params.push(`%, ${keyword.toLowerCase().trim()},%`); }
  if (author) { where.push('a.name LIKE ?'); params.push(`%${author.trim()}%`); }

  const fts = ftsQuery(q);
  const join = fts ? 'JOIN thesis_fts f ON f.thesis_id = t.id' : '';
  if (fts) { where.push('thesis_fts MATCH ?'); params.push(fts); }

  const sort = {
    relevance: fts ? 'bm25(thesis_fts, 10.0, 4.0, 6.0, 5.0, 1.0)' : 'c.published_date DESC',
    newest: 't.year DESC, c.published_date DESC',
    oldest: 't.year ASC',
    title: 't.title COLLATE NOCASE ASC',
  }[query.sort || 'relevance'] || 'c.published_date DESC';

  const base = `FROM theses t
      JOIN users a ON a.id = t.author_id
      JOIN catalogue_records c ON c.thesis_id = t.id
      LEFT JOIN users g ON g.id = t.guide_id
      LEFT JOIN departments d ON d.id = t.department_id
      ${join}
     WHERE ${where.join(' AND ')}`;

  try {
    const total = one(`SELECT COUNT(*) AS n ${base}`, ...params).n;
    const rows = all(`
      SELECT t.id, t.title, t.abstract, t.keywords, t.year, t.degree, t.author_id, t.guide_id, t.examiner_id, t.current_version_id AS version_id,
             a.name AS author_name, g.name AS guide_name, d.name AS department,
             c.accession_no, c.doi, c.visibility, c.published_date, c.category, c.research_area
             ${fts ? `, snippet(thesis_fts, 4, '[[', ']]', ' … ', 18) AS snippet` : ''}
        ${base} ORDER BY ${sort} LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
    return {
      total, page, pageSize,
      results: rows.map(r => ({
        ...r,
        canDownload: canDownloadPublished(user, r, r.visibility),
        snippet: r.snippet && r.snippet.includes('[[') ? r.snippet : null,
        author_id: undefined, guide_id: undefined, examiner_id: undefined,
      })),
    };
  } catch (err) {
    if (String(err.message).includes('fts5')) fail('INVALID_FILTER', 'The search query could not be understood.', 422);
    fail('SEARCH_UNAVAILABLE', 'Search is temporarily unavailable.', 503);
  }
}

export function facets(user) {
  const vis = user ? '' : `AND c.visibility = 'Public'`;
  return {
    departments: all(`SELECT d.id, d.name, COUNT(c.id) AS n FROM departments d
      LEFT JOIN theses t ON t.department_id = d.id AND t.status = 'Published'
      LEFT JOIN catalogue_records c ON c.thesis_id = t.id ${vis}
      GROUP BY d.id ORDER BY d.name`),
    years: all(`SELECT t.year, COUNT(*) AS n FROM theses t JOIN catalogue_records c ON c.thesis_id = t.id
      WHERE t.status = 'Published' ${vis} GROUP BY t.year ORDER BY t.year DESC`),
    total: one(`SELECT COUNT(*) AS n FROM theses t JOIN catalogue_records c ON c.thesis_id = t.id WHERE t.status = 'Published' ${vis}`).n,
  };
}
