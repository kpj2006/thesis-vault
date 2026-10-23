// Cataloguing (UC-013/UC-014) and repository search (UC-015)
import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { catalogueQueue, catalogueDetail, saveCatalogueMetadata, completeCataloguing, publishToRepository, setVisibility } from '../services/catalogue.js';
import { searchTheses, facets } from '../services/search.js';

const r = Router();
const librarian = requireRole('librarian', 'admin');

r.get('/catalogue/queue', librarian, (req, res) => res.json({ theses: catalogueQueue() }));
r.get('/catalogue/:id', librarian, (req, res) => res.json(catalogueDetail(req.user, req.params.id)));
r.put('/catalogue/:id', librarian, (req, res) => res.json(saveCatalogueMetadata(req.user, req.params.id, req.body, req.ip)));
r.post('/catalogue/:id/complete', librarian, (req, res) => res.json(completeCataloguing(req.user, req.params.id, req.body, req.ip)));
r.post('/catalogue/:id/publish', librarian, (req, res) => res.json(publishToRepository(req.user, req.params.id, req.ip)));
r.put('/catalogue/:id/visibility', librarian, (req, res) => res.json(setVisibility(req.user, req.params.id, req.body.visibility, req.ip)));

// Open to guests (public theses only) and every signed-in role.
r.get('/repository/search', (req, res) => res.json(searchTheses(req.user, req.query)));
r.get('/repository/facets', (req, res) => res.json(facets(req.user)));

export default r;
