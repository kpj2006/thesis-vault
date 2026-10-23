// Seeds demo data by driving theses through the real services, so every record, approval and history
// entry is produced exactly as it would be in use.  Usage: npm run seed  |  npm run reset (wipe first)
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

if (process.argv.includes('--reset')) {
  fs.rmSync(config.dataDir, { recursive: true, force: true });
  console.log('Existing data removed.');
}

const { db, one, run, insert } = await import('./database.js');
if (one('SELECT COUNT(*) AS n FROM users').n > 0) {
  console.log('Database already has users; run "npm run reset" to start from scratch.');
  process.exit(0);
}

const bcrypt = (await import('bcryptjs')).default;
const { makePdf } = await import('../services/storage.js');
const { submitThesis, saveDraft, uploadRevision } = await import('../services/submission.js');
const { recordReview, addAnnotation } = await import('../services/review.js');
const { saveCatalogueMetadata, completeCataloguing, publishToRepository } = await import('../services/catalogue.js');

const PASSWORD = 'Password@123';
const hash = bcrypt.hashSync(PASSWORD, 10);

const departments = [
  ['CSE', 'Computer Science and Engineering'],
  ['ECE', 'Electronics and Communication Engineering'],
  ['CCE', 'Communication and Computer Engineering'],
  ['ME', 'Mechanical-Mechatronics Engineering'],
  ['PHY', 'Physics'],
  ['MATH', 'Mathematics'],
  ['HSS', 'Humanities and Social Sciences'],
];
const dept = {};
for (const [code, name] of departments) dept[code] = insert('INSERT INTO departments (code, name) VALUES (?, ?)', code, name);

const users = {};
const addUser = (key, name, email, role, d, extra = {}) => {
  const id = insert(`INSERT INTO users (name, email, password_hash, role, department_id, specialization, roll_number, guide_id, contact)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, name, email, hash, role, d ? dept[d] : null, extra.specialization || null,
    extra.roll || null, extra.guide ? users[extra.guide].id : null, extra.contact || null);
  users[key] = one('SELECT id, name, email, role, department_id, guide_id, status FROM users WHERE id = ?', id);
};

addUser('admin', 'System Administrator', 'admin@lnmiit.ac.in', 'admin', null);
addUser('librarian', 'Meera Joshi', 'librarian@lnmiit.ac.in', 'librarian', null);
addUser('director', 'Dean of Research', 'dean.research@lnmiit.ac.in', 'institute', null);
addUser('guideCse', 'Dr. Rajesh Verma', 'guide@lnmiit.ac.in', 'supervisor', 'CSE', { specialization: 'Distributed Systems' });
addUser('guideEce', 'Dr. Anita Kulkarni', 'anita.kulkarni@lnmiit.ac.in', 'supervisor', 'ECE', { specialization: 'Signal Processing' });
addUser('guideMath', 'Dr. Sanjay Mehta', 'sanjay.mehta@lnmiit.ac.in', 'supervisor', 'MATH', { specialization: 'Applied Mathematics' });
addUser('guidePhy', 'Dr. Kavita Rao', 'kavita.rao@lnmiit.ac.in', 'supervisor', 'PHY', { specialization: 'Condensed Matter' });
addUser('examiner', 'Prof. Vikram Singh', 'examiner@lnmiit.ac.in', 'examiner', 'CSE', { specialization: 'Machine Learning' });
addUser('examiner2', 'Prof. Neha Bansal', 'neha.bansal@lnmiit.ac.in', 'examiner', 'ECE', { specialization: 'VLSI Design' });
addUser('scholar', 'Aarav Sharma', 'scholar@lnmiit.ac.in', 'scholar', 'CSE', { guide: 'guideCse', roll: '21PCS001' });
addUser('s2', 'Ishita Agarwal', 'ishita.agarwal@lnmiit.ac.in', 'scholar', 'CSE', { guide: 'guideCse', roll: '20PCS004' });
addUser('s3', 'Rohan Gupta', 'rohan.gupta@lnmiit.ac.in', 'scholar', 'ECE', { guide: 'guideEce', roll: '19PEC002' });
addUser('s4', 'Priya Nair', 'priya.nair@lnmiit.ac.in', 'scholar', 'MATH', { guide: 'guideMath', roll: '19PMA001' });
addUser('s5', 'Karan Malhotra', 'karan.malhotra@lnmiit.ac.in', 'scholar', 'PHY', { guide: 'guidePhy', roll: '20PPH003' });
addUser('s6', 'Sneha Reddy', 'sneha.reddy@lnmiit.ac.in', 'scholar', 'ECE', { guide: 'guideEce', roll: '21PEC005' });
addUser('s7', 'Aditya Jain', 'aditya.jain@lnmiit.ac.in', 'scholar', 'CSE', { guide: 'guideCse', roll: '22PCS007' });
addUser('s8', 'Tanvi Kapoor', 'tanvi.kapoor@lnmiit.ac.in', 'scholar', 'MATH', { guide: 'guideMath', roll: '21PMA002' });
addUser('newScholar', 'Dev Patel', 'dev.patel@lnmiit.ac.in', 'scholar', 'CSE', { roll: '24PCS010' }); // no guide yet

const T = [
  {
    key: 'fed', by: 's2', d: 'CSE', year: 2022, degree: 'PhD', end: 'Published', ddc: '006.31', cat: 'Machine Learning',
    title: 'Privacy-Preserving Federated Learning for Heterogeneous Edge Devices',
    keywords: 'federated learning, differential privacy, edge computing, non-IID data',
    abstract: 'This thesis studies federated learning when participating edge devices differ widely in compute, memory and data distribution. We propose an adaptive client selection scheme combined with per-layer differential privacy noise, and show that it reduces communication rounds while bounding privacy loss on non-IID benchmarks.',
    body: [
      'Federated optimisation on phones and gateways suffers from stragglers whose local epochs finish long after the aggregation deadline. Our scheduler estimates each device budget from recent round latencies and assigns proportional workloads.',
      'Gaussian noise calibrated per layer keeps the privacy accountant within epsilon of four while losing under two points of accuracy on FEMNIST and Shakespeare. Ablations isolate the contribution of momentum correction at the server.',
      'A deployment across forty Raspberry Pi nodes in the campus laboratory confirms the simulated speedups and exposes energy constraints that motivate the final chapter on battery-aware participation.',
    ],
  },
  {
    key: 'chan', by: 's3', d: 'ECE', year: 2021, degree: 'PhD', end: 'Published', ddc: '621.3822', cat: 'Signal Processing',
    title: 'Deep Learning Based Channel Estimation for Millimetre-Wave Massive MIMO',
    keywords: 'channel estimation, massive MIMO, millimetre wave, deep learning',
    abstract: 'Millimetre-wave massive MIMO links need accurate channel state information, yet pilot overhead grows with antenna count. This work treats the angular-delay channel as an image and trains a denoising convolutional network that recovers it from few pilots, outperforming compressed sensing baselines at low SNR.',
    body: [
      'Ray-traced urban microcell scenes generated with the DeepMIMO toolkit provide training data at twenty-eight gigahertz. Beam-squint effects are modelled explicitly so the estimator generalises across subcarriers.',
      'The proposed network halves normalised mean squared error relative to orthogonal matching pursuit when only one eighth of the pilots are transmitted, and inference fits within the coherence time on an embedded GPU.',
    ],
  },
  {
    key: 'graph', by: 's4', d: 'MATH', year: 2020, degree: 'PhD', end: 'Published', ddc: '511.5', cat: 'Graph Theory',
    title: 'Spectral Bounds on the Domination Number of Cayley Graphs',
    keywords: 'graph theory, domination number, Cayley graphs, spectral methods',
    abstract: 'We derive new upper and lower bounds on the domination number of Cayley graphs over finite abelian groups using the eigenvalues of the adjacency operator. The bounds are tight for several infinite families, including Paley graphs of prime order, and yield an efficient algorithm for near-optimal dominating sets.',
    body: [
      'Character theory turns the adjacency spectrum of an abelian Cayley graph into explicit exponential sums, which we bound with Weil-type estimates to control expansion between candidate dominating sets.',
      'Computational experiments over all connected Cayley graphs on up to sixty-four vertices confirm the inequalities and reveal three sporadic graphs where the lower bound is attained.',
    ],
  },
  {
    key: 'perov', by: 's5', d: 'PHY', year: 2023, degree: 'PhD', end: 'Published', ddc: '537.6226', cat: 'Condensed Matter Physics', vis: 'Restricted',
    title: 'Defect Engineering in Lead-Free Halide Perovskites for Stable Photovoltaics',
    keywords: 'perovskites, photovoltaics, defect engineering, density functional theory',
    abstract: 'Lead-free tin and bismuth halide perovskites promise non-toxic solar absorbers but degrade quickly in air. Combining first-principles calculations with thin-film experiments, this thesis identifies the vacancy complexes responsible for oxidation and demonstrates additive strategies that extend device lifetime fivefold.',
    body: [
      'Hybrid functional calculations rank formation energies of tin vacancies, iodine interstitials and their complexes under iodine-rich growth, predicting deep traps that match photoluminescence quenching.',
      'Films prepared with a reducing phenylhydrazine additive retain eighty percent of initial efficiency after five hundred hours of damp-heat testing, compared with one hundred hours for control devices.',
    ],
  },
  {
    key: 'nlp', by: 's2', d: 'CSE', year: 2024, degree: 'M.Tech', end: 'Published', ddc: '006.35', cat: 'Natural Language Processing',
    title: 'Low-Resource Neural Machine Translation for Rajasthani Dialects',
    keywords: 'machine translation, low-resource languages, transfer learning, Rajasthani',
    abstract: 'Rajasthani dialects have little parallel text available for machine translation. We assemble a twelve thousand sentence corpus from folk literature and government notices, and show that multilingual pretraining followed by dialect-aware back-translation yields usable Hindi to Marwari and Mewari translation.',
    body: [
      'Annotators from Jodhpur and Udaipur verified alignments, and a script normaliser reconciles inconsistent Devanagari spellings that otherwise fragment the vocabulary.',
      'Fine-tuning mBART with tagged back-translation improves chrF by nine points over training from scratch, and human raters judge sixty-two percent of outputs as adequate.',
    ],
  },
  {
    key: 'vlsi', by: 's6', d: 'ECE', year: 2022, degree: 'M.Tech', end: 'Published', ddc: '621.395', cat: 'VLSI Design',
    title: 'Approximate Multiplier Architectures for Energy-Efficient Neural Accelerators',
    keywords: 'approximate computing, VLSI, multipliers, neural network accelerators',
    abstract: 'Neural network inference tolerates small arithmetic errors. This thesis designs logarithmic and truncation-based approximate multipliers, synthesises them in a forty-five nanometre library, and integrates them into a systolic array that saves thirty-eight percent energy with under one percent accuracy loss on ImageNet subsets.',
    body: [
      'Error characterisation uses mean relative error distance and its distribution across operand ranges, guiding which partial products may be dropped safely.',
      'Post-layout power analysis of an eight by eight systolic array shows the savings scale with array size because multipliers dominate dynamic power.',
    ],
  },
  {
    key: 'opt', by: 's8', d: 'MATH', year: 2024, degree: 'MS (Research)', end: 'Published', ddc: '519.6', cat: 'Optimisation',
    title: 'Convergence of Stochastic Proximal Methods for Non-Smooth Composite Optimisation',
    keywords: 'stochastic optimisation, proximal methods, convergence analysis, non-smooth',
    abstract: 'Composite objectives that pair a smooth loss with a non-smooth regulariser arise throughout statistics and signal recovery. We prove last-iterate convergence rates for variance-reduced stochastic proximal gradient methods under a weak sharpness condition and verify them on sparse logistic regression.',
    body: [
      'The analysis replaces strong convexity with a quadratic growth assumption around the solution set, which holds for lasso-type problems with non-unique minimisers.',
      'Experiments on the RCV1 and news20 datasets show the theoretical step sizes are practical without tuning.',
    ],
  },
  {
    key: 'blockchain', by: 's7', d: 'CSE', year: 2025, degree: 'M.Tech', end: 'Catalogued', ddc: '005.82', cat: 'Distributed Systems',
    title: 'A Permissioned Blockchain Framework for Academic Credential Verification',
    keywords: 'blockchain, credential verification, Hyperledger Fabric, smart contracts',
    abstract: 'Employers and universities spend weeks verifying degree certificates by email. This thesis builds a Hyperledger Fabric network in which institutes anchor credential hashes, and evaluates throughput, privacy of student records and the governance model needed for multiple universities to participate.',
    body: ['Chaincode endorsement policies require two institutional peers, and private data collections keep transcripts off the shared ledger while their hashes remain verifiable by third parties.'],
  },
  {
    key: 'soil', by: 's6', d: 'ECE', year: 2025, degree: 'PhD', end: 'Approved',
    title: 'Low-Power LoRa Sensor Networks for Precision Irrigation in Arid Regions',
    keywords: 'LoRa, wireless sensor networks, precision agriculture, energy harvesting',
    abstract: 'Farms in western Rajasthan lose much of their irrigation water to evaporation and over-watering. This thesis deploys solar-harvesting soil moisture nodes on LoRa links spanning eight kilometres and develops a duty-cycling policy that keeps nodes alive through monsoon cloud cover.',
    body: ['Field trials near Bikaner over two growing seasons reduced water use by twenty-seven percent for mustard crops without measurable yield loss.'],
  },
  {
    key: 'quantum', by: 's5', d: 'PHY', year: 2025, degree: 'PhD', end: 'UnderCommitteeReview',
    title: 'Topological Phases in Twisted Bilayer Graphene Under Strain',
    keywords: 'twisted bilayer graphene, topological phases, strain, moire superlattices',
    abstract: 'Heterostrain modifies the flat bands of magic-angle twisted bilayer graphene. Using continuum models and tight-binding calculations we map how uniaxial strain shifts Chern numbers of the isolated bands and predict transport signatures observable in current devices.',
    body: ['Wannier obstructions identified at small strain disappear beyond a critical value of zero point three percent, coinciding with a gap closing at the moire K point.'],
  },
  {
    key: 'iot', by: 's7', d: 'CSE', year: 2026, degree: 'M.Tech', end: 'UnderGuideReview',
    title: 'Lightweight Intrusion Detection for Resource-Constrained IoT Networks',
    keywords: 'intrusion detection, IoT security, TinyML, anomaly detection',
    abstract: 'Smart home devices rarely have the memory for signature-based intrusion detection. We quantise a gradient boosted classifier to run on ESP32 gateways and detect botnet scanning and flooding attacks from flow statistics with ninety-six percent recall on the CIC IoT 2023 dataset.',
    body: ['Feature selection keeps eleven flow attributes computable in a single pass, so detection adds under four milliseconds of latency per window.'],
  },
  {
    key: 'graphnn', by: 'scholar', d: 'CSE', year: 2026, degree: 'PhD', end: 'RevisionRequired',
    title: 'Graph Neural Networks for Traffic Forecasting in Indian Metropolitan Cities',
    keywords: 'graph neural networks, traffic forecasting, spatio-temporal models, smart cities',
    abstract: 'Traffic in Indian cities is irregular, with mixed vehicle types and frequent unplanned closures. This thesis builds a spatio-temporal graph neural network over road sensor data from Jaipur and Bengaluru and studies how incorporating event calendars and weather improves short-horizon speed forecasts.',
    body: ['Diffusion convolution over the road graph captures upstream congestion, while a gated temporal module adapts to festival-day anomalies that break weekly periodicity.'],
  },
  {
    key: 'rejected', by: 's3', d: 'ECE', year: 2024, degree: 'M.Tech', end: 'Rejected',
    title: 'Survey of Antenna Designs for Wearable Devices',
    keywords: 'antennas, wearables, survey',
    abstract: 'A review of textile and flexible antenna designs reported for wearable devices between 2010 and 2020, summarising bandwidth, gain and specific absorption rate figures from published literature.',
    body: ['The document compiles tables of previously published antenna results without new measurements or analysis.'],
  },
];

const fileFor = t => {
  const buffer = makePdf(t.title, [`Abstract. ${t.abstract}`, ...t.body, `Keywords: ${t.keywords}.`]);
  return { originalname: `${t.key}-thesis.pdf`, size: buffer.length, buffer };
};
const meta = t => ({ title: t.title, abstract: t.abstract, keywords: t.keywords, department_id: dept[t.d], degree: t.degree, year: t.year, declaration: 'true' });
const guideOf = t => one('SELECT * FROM users WHERE id = ?', users[t.by].guide_id);
const ORDER = ['UnderGuideReview', 'RevisionRequired', 'UnderCommitteeReview', 'Approved', 'Catalogued', 'Published'];
const reached = (t, s) => t.end !== 'Rejected' && ORDER.indexOf(t.end) >= ORDER.indexOf(s);

const created = {};
for (const t of T) {
  const scholar = users[t.by];
  const { thesisId } = await submitThesis(scholar, { body: meta(t), file: fileFor(t) });
  created[t.key] = thesisId;
  const guide = guideOf(t);

  if (t.end === 'RevisionRequired') {
    addAnnotation(guide, thesisId, { page: 1, note: 'Related work omits STGCN and Graph WaveNet baselines.' });
    recordReview(guide, thesisId, {
      outcome: 'RevisionRequested', comments: 'Solid problem framing and data collection. Evaluation needs stronger baselines.',
      feedback: 'Add comparisons with STGCN and Graph WaveNet, report MAE at 15/30/60 minute horizons, and include an ablation for the event-calendar features.',
    });
    continue;
  }
  if (t.end === 'Rejected') {
    recordReview(guide, thesisId, { outcome: 'Approved', comments: 'Forwarding to committee for an independent view on contribution.' });
    const ex = one('SELECT u.* FROM theses t JOIN users u ON u.id = t.examiner_id WHERE t.id = ?', thesisId);
    recordReview(ex, thesisId, { outcome: 'Rejected', comments: 'The work is a literature compilation without original contribution, which does not meet the M.Tech thesis requirement.' });
    continue;
  }
  if (!reached(t, 'UnderCommitteeReview')) continue;

  // Show a full revision cycle on one published thesis.
  if (t.key === 'fed') {
    recordReview(guide, thesisId, { outcome: 'RevisionRequested', comments: 'Good results; the privacy analysis needs to be complete.',
      feedback: 'Include the full Renyi-DP accounting derivation in chapter 4 and report variance over five seeds.' });
    await uploadRevision(scholar, { thesisId, file: fileFor({ ...t, body: [...t.body, 'Revision note: the complete Renyi differential privacy accountant derivation now appears in chapter four, with results averaged over five random seeds.'] }),
      notes: 'Added full RDP accounting derivation (Ch. 4) and five-seed variance for all tables.', declaration: 'true' });
  }
  recordReview(guide, thesisId, { outcome: 'Approved', comments: 'The thesis meets the standard for submission to the committee.' });
  const thesis = one('SELECT examiner_id FROM theses WHERE id = ?', thesisId);
  const examiner = one('SELECT * FROM users WHERE id = ?', thesis.examiner_id);
  if (!reached(t, 'Approved')) continue;
  recordReview(examiner, thesisId, { outcome: 'Approved', comments: 'Methodology is rigorous and the contribution is clearly established.' });
  if (!reached(t, 'Catalogued')) continue;
  const cat = { ...meta(t), ddc_class: t.ddc, category: t.cat, research_area: t.cat, visibility: t.vis || 'Public' };
  saveCatalogueMetadata(users.librarian, thesisId, cat);
  completeCataloguing(users.librarian, thesisId, cat);
  if (reached(t, 'Published')) publishToRepository(users.librarian, thesisId);
}

// A draft with metadata but no document yet.
await saveDraft(users.s8, { body: { title: 'Fractional Differential Equations in Epidemic Modelling', department_id: dept.MATH, degree: 'PhD', year: 2026,
  keywords: 'fractional calculus, epidemiology', abstract: '' } });

// Spread timestamps over past years so reports and timelines look realistic.
for (const t of T) {
  const id = created[t.key];
  const offsetDays = Math.max(0, (2026 - t.year) * 365 - 40) + 30;
  run(`UPDATE theses SET submission_date = datetime(submission_date, ?), created_at = datetime(created_at, ?) WHERE id = ?`, `-${offsetDays} days`, `-${offsetDays + 20} days`, id);
  run(`UPDATE catalogue_records SET published_date = datetime(published_date, ?), catalogue_date = datetime(catalogue_date, ?) WHERE thesis_id = ?`,
    `-${Math.max(0, offsetDays - 120)} days`, `-${Math.max(0, offsetDays - 115)} days`, id);
  run(`UPDATE thesis_history SET created_at = datetime(created_at, ?) WHERE thesis_id = ?`, `-${Math.max(0, offsetDays - 120)} days`, id);
}
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

// Sample documents for trying the submission flow by hand.
const samples = path.join(config.root, 'samples');
fs.mkdirSync(samples, { recursive: true });
fs.writeFileSync(path.join(samples, 'original-thesis.pdf'), makePdf('Explainable Anomaly Detection in Hospital Supply Chains', [
  'Abstract. Hospital supply chains in tier two Indian cities face stock-outs of essential drugs that are hard to predict. We combine isolation forests with SHAP explanations so pharmacists can see which suppliers and seasons drive each alert.',
  'Twelve months of procurement records from three district hospitals were cleaned and aligned to a common drug formulary before modelling.',
  'Pharmacists rated eighty-one percent of the explanations as useful, and the alert precision at the top fifty anomalies reached zero point seven four.',
]));
const copied = T.find(t => t.key === 'fed');
fs.writeFileSync(path.join(samples, 'plagiarised-thesis.pdf'), makePdf('Edge Federated Learning Study', [`Abstract. ${copied.abstract}`, ...copied.body]));

console.log(`Seeded ${T.length + 1} theses and ${Object.keys(users).length} users.`);
console.log(`All demo accounts use the password: ${PASSWORD}`);
console.log('Sample PDFs written to samples/ (one clean, one that will be flagged by the similarity check).');
