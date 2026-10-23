// DocumentStorage component (Lab 4 §1.15, Lab 7 IFileStorage.storeOrRetrieve)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractText as pdfText, getDocumentProxy } from 'unpdf';
import { config } from '../config.js';
import { fail } from '../errors.js';

// NFR-015: PDF is the only accepted submission format. Checks the magic bytes, not just the extension.
export function validatePdf(file) {
  if (!file) fail('INVALID_FILE', 'Please attach the thesis document as a PDF file.');
  const looksPdf = file.buffer?.subarray(0, 5).toString('latin1') === '%PDF-';
  if (!looksPdf || !/\.pdf$/i.test(file.originalname || '')) {
    fail('INVALID_FILE', 'Only PDF files are accepted. Please upload your thesis as a .pdf document.');
  }
  if (file.size === 0) fail('INVALID_FILE', 'The uploaded file is empty.');
}

export async function extractText(buffer) {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text, totalPages } = await pdfText(pdf, { mergePages: true });
    return { text: (text || '').replace(/\s+/g, ' ').trim(), pages: totalPages || null };
  } catch {
    return { text: '', pages: null }; // scanned or malformed PDFs still archive; they just aren't full-text indexed
  }
}

// Writes via a temp file and rename so an interrupted upload never leaves a half-written document (NFR-008).
export function storeFile(thesisId, versionNumber, buffer) {
  const dir = path.join(config.uploadDir, String(thesisId));
  fs.mkdirSync(dir, { recursive: true });
  const name = `v${versionNumber}-${crypto.randomUUID()}.pdf`;
  const tmp = path.join(dir, `.${name}.part`);
  try {
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, path.join(dir, name));
  } catch {
    fs.rmSync(tmp, { force: true });
    fail('UPLOAD_FAILED', 'The document could not be saved. Please try the upload again.', 500);
  }
  return path.posix.join(String(thesisId), name);
}

export function removeFile(relPath) {
  if (relPath) fs.rmSync(resolveFile(relPath), { force: true });
}

export function resolveFile(relPath) {
  const full = path.resolve(config.uploadDir, relPath);
  if (!full.startsWith(path.resolve(config.uploadDir) + path.sep)) fail('ACCESS_DENIED', 'Invalid file reference.', 403);
  return full;
}

// Minimal text-only PDF writer, used by the seed script and tests to produce realistic sample documents.
export function makePdf(title, paragraphs) {
  const esc = s => s.replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e]/g, '');
  const wrap = (text, width) => {
    const out = []; let line = '';
    for (const word of text.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > width) { out.push(line); line = word; }
      else line = (line + ' ' + word).trim();
    }
    if (line) out.push(line);
    return out;
  };
  const lines = [{ t: title, size: 16 }, { t: '', size: 11 }];
  for (const p of paragraphs) { for (const l of wrap(p, 88)) lines.push({ t: l, size: 11 }); lines.push({ t: '', size: 11 }); }
  const perPage = 48;
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));

  const objs = [];
  const add = body => { objs.push(body); return objs.length; };
  const catalog = add(null); const pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (const pg of pages) {
    let y = 790; let stream = 'BT\n';
    for (const l of pg) { stream += `/F1 ${l.size} Tf 1 0 0 1 56 ${y} Tm (${esc(l.t)}) Tj\n`; y -= l.size === 16 ? 24 : 15; }
    stream += 'ET';
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
