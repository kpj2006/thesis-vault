// Plagiarism Check Service (FR-021..FR-024, BR-003, Lab 7 ISimilarityService.checkDocument)
//
// The SRS puts an in-house plagiarism engine out of scope, so this module is an adapter around a
// third-party similarity service. Two providers are available:
//   - "http": POSTs the document text to PLAGIARISM_API_URL and expects { similarityScore, matches? }.
//   - "mock": a development stand-in used while no institutional licence is available. It estimates
//             overlap against theses already held in Thesis Vault using 6-word shingles.
import { config } from '../config.js';
import { all, insert, getSetting } from '../db/database.js';
import { fail } from '../errors.js';

export const threshold = () => Number(getSetting('plagiarism_threshold') || 20);

const shingles = (text, n = 6) => {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i + n <= words.length; i++) set.add(words.slice(i, i + n).join(' '));
  return set;
};

async function mockProvider(text, excludeThesisId) {
  const doc = shingles(text);
  if (doc.size === 0) return { similarityScore: 0, matches: [], note: 'No extractable text; manual check recommended.' };
  // Compare against the latest version of every other thesis.
  const sources = all(`
    SELECT t.id, t.title, u.name AS author, v.full_text
      FROM theses t
      JOIN users u ON u.id = t.author_id
      JOIN thesis_versions v ON v.id = t.current_version_id
     WHERE t.id <> ? AND v.full_text <> ''`, excludeThesisId ?? -1);
  const covered = new Set();
  const matches = [];
  for (const s of sources) {
    const src = shingles(s.full_text);
    let hit = 0;
    for (const sh of doc) if (src.has(sh)) { hit++; covered.add(sh); }
    if (hit) matches.push({ thesisId: s.id, title: s.title, author: s.author, percent: +(hit / doc.size * 100).toFixed(1) });
  }
  matches.sort((a, b) => b.percent - a.percent);
  return { similarityScore: +(covered.size / doc.size * 100).toFixed(1), matches: matches.slice(0, 5) };
}

async function httpProvider(text, excludeThesisId, versionRef) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.plagiarism.timeoutMs);
  try {
    const res = await fetch(config.plagiarism.apiUrl, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.plagiarism.apiKey}` },
      body: JSON.stringify({ documentId: versionRef, text }),
    });
    if (!res.ok) fail('SERVICE_UNAVAILABLE', 'The similarity-check service is unavailable. Please try again later.', 503);
    const body = await res.json();
    return { similarityScore: Number(body.similarityScore), matches: body.matches || [] };
  } catch (err) {
    if (err.name === 'AbortError') fail('TIMEOUT', 'The similarity-check service did not respond in time. Please try again.', 504);
    if (err.code) throw err;
    fail('SERVICE_UNAVAILABLE', 'The similarity-check service is unavailable. Please try again later.', 503);
  } finally {
    clearTimeout(timer);
  }
}

export const toolName = () => config.plagiarism.provider === 'http' ? 'External similarity API' : 'Thesis Vault similarity stub (dev)';

// Runs the check without persisting anything, so a brand-new flagged submission leaves no thesis behind (Lab 7 §4.1 step 4).
export async function runSimilarity(text, { excludeThesisId, versionRef } = {}) {
  const result = config.plagiarism.provider === 'http'
    ? await httpProvider(text, excludeThesisId, versionRef)
    : await mockProvider(text, excludeThesisId);
  if (!Number.isFinite(result.similarityScore)) fail('INVALID_DOCUMENT', 'The similarity service returned an invalid result.', 502);
  const limit = threshold();
  return { ...result, threshold: limit, passed: result.similarityScore < limit, tool: toolName() };
}

export function recordCheck(thesisId, versionId, result) {
  return insert(
    `INSERT INTO plagiarism_checks (thesis_id, version_id, similarity_score, threshold, tool, status, report_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    thesisId, versionId, result.similarityScore, result.threshold, result.tool,
    result.passed ? 'Passed' : 'Flagged',
    JSON.stringify({ matches: result.matches, note: result.note || null }),
  );
}

export const checksFor = thesisId => all(
  `SELECT p.*, v.version_number FROM plagiarism_checks p LEFT JOIN thesis_versions v ON v.id = p.version_id
    WHERE p.thesis_id = ? ORDER BY p.id DESC`, thesisId,
).map(c => ({ ...c, report: c.report_json ? JSON.parse(c.report_json) : null, report_json: undefined }));
