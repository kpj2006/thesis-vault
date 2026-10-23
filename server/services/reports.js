// Research output reports and dashboards (FR j, UC-019, BR-010)
import { one, all } from '../db/database.js';

export function researchReport({ yearFrom, yearTo, department } = {}) {
  const where = ['1 = 1'];
  const params = [];
  if (yearFrom) { where.push('t.year >= ?'); params.push(Number(yearFrom)); }
  if (yearTo) { where.push('t.year <= ?'); params.push(Number(yearTo)); }
  if (department) { where.push('t.department_id = ?'); params.push(Number(department)); }
  const w = where.join(' AND ');
  const nonDraft = `${w} AND t.status <> 'Draft'`;

  const byStatus = all(`SELECT t.status, COUNT(*) AS n FROM theses t WHERE ${nonDraft} GROUP BY t.status`, ...params);
  const count = s => byStatus.find(r => r.status === s)?.n || 0;
  const totalSubmitted = byStatus.reduce((a, r) => a + r.n, 0);

  return {
    summary: {
      totalSubmitted,
      inReview: count('UnderGuideReview') + count('UnderCommitteeReview') + count('Submitted'),
      revisionRequired: count('RevisionRequired'),
      awaitingCataloguing: count('Approved') + count('Catalogued'),
      published: count('Published'),
      rejected: count('Rejected'),
      avgSimilarity: one(`SELECT ROUND(AVG(p.similarity_score), 1) AS v FROM plagiarism_checks p JOIN theses t ON t.id = p.thesis_id WHERE ${w}`, ...params).v,
      flaggedChecks: one(`SELECT COUNT(*) AS n FROM plagiarism_checks p JOIN theses t ON t.id = p.thesis_id WHERE ${w} AND p.status = 'Flagged'`, ...params).n,
      avgDaysToPublish: one(`SELECT ROUND(AVG(julianday(c.published_date) - julianday(t.submission_date)), 1) AS v
        FROM theses t JOIN catalogue_records c ON c.thesis_id = t.id WHERE ${w} AND c.published_date IS NOT NULL AND t.submission_date IS NOT NULL`, ...params).v,
      avgRevisionsPerThesis: one(`SELECT ROUND(AVG(n), 2) AS v FROM (SELECT COUNT(rr.id) AS n FROM theses t
        LEFT JOIN revision_requests rr ON rr.thesis_id = t.id WHERE ${nonDraft} GROUP BY t.id)`, ...params).v,
    },
    byStatus,
    byDepartment: all(`SELECT d.name AS department,
        SUM(t.status <> 'Draft') AS submitted, SUM(t.status = 'Published') AS published,
        SUM(t.status IN ('UnderGuideReview','UnderCommitteeReview','RevisionRequired')) AS in_progress
      FROM departments d LEFT JOIN theses t ON t.department_id = d.id AND ${w}
      GROUP BY d.id HAVING submitted > 0 ORDER BY submitted DESC`, ...params),
    byYear: all(`SELECT t.year, COUNT(*) AS published FROM theses t WHERE ${w} AND t.status = 'Published' GROUP BY t.year ORDER BY t.year`, ...params),
    byDegree: all(`SELECT t.degree, COUNT(*) AS n FROM theses t WHERE ${nonDraft} GROUP BY t.degree ORDER BY n DESC`, ...params),
    monthlySubmissions: all(`SELECT strftime('%Y-%m', t.submission_date) AS month, COUNT(*) AS n FROM theses t
      WHERE ${w} AND t.submission_date >= date('now', '-11 months', 'start of month') GROUP BY month ORDER BY month`, ...params),
    similarityBuckets: all(`SELECT CASE WHEN p.similarity_score < 5 THEN '0–5%' WHEN p.similarity_score < 10 THEN '5–10%'
        WHEN p.similarity_score < 20 THEN '10–20%' ELSE '20%+' END AS bucket, COUNT(*) AS n
      FROM plagiarism_checks p JOIN theses t ON t.id = p.thesis_id WHERE ${w} GROUP BY bucket ORDER BY MIN(p.similarity_score)`, ...params),
    reviewerWorkload: all(`SELECT u.name, u.role,
        SUM(t.status = CASE u.role WHEN 'supervisor' THEN 'UnderGuideReview' ELSE 'UnderCommitteeReview' END) AS pending,
        COUNT(t.id) AS total
      FROM users u LEFT JOIN theses t ON (u.role = 'supervisor' AND t.guide_id = u.id) OR (u.role = 'examiner' AND t.examiner_id = u.id)
      WHERE u.role IN ('supervisor','examiner') AND u.status = 'active'
      GROUP BY u.id HAVING total > 0 ORDER BY pending DESC, total DESC LIMIT 12`),
  };
}

export function publishedCsv() {
  const rows = all(`SELECT c.accession_no, t.title, a.name AS author, g.name AS guide, d.name AS department, t.degree, t.year,
      t.keywords, c.ddc_class, c.category, c.visibility, c.doi, c.published_date
    FROM theses t JOIN users a ON a.id = t.author_id LEFT JOIN users g ON g.id = t.guide_id
    LEFT JOIN departments d ON d.id = t.department_id JOIN catalogue_records c ON c.thesis_id = t.id
    WHERE t.status = 'Published' ORDER BY t.year DESC, c.accession_no`);
  const cols = ['accession_no', 'title', 'author', 'guide', 'department', 'degree', 'year', 'keywords', 'ddc_class', 'category', 'visibility', 'doi', 'published_date'];
  const cell = v => {
    const s = v == null ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // neutralise spreadsheet formula injection
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
}
