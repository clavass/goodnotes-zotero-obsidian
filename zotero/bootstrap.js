/* GoodNotes Sync for Zotero
 *
 * Keeps Zotero in step with a folder of PDFs that mirrors your GoodNotes library
 * (see README.md). Every 5 minutes, while Zotero is open:
 *  A) applies the moves/renames recorded by goodnotes-sync.sh (moves.tsv): relinks the PDF
 *     and moves the item to the collection named after its new folder;
 *  B) repairs broken links by looking for a file with the same name in the folder;
 *  C) imports new PDFs of the folder that are papers (a DOI in their first 2 pages):
 *     links them (no copy) to the item with the same DOI, or creates the item from the DOI,
 *     in the collection named after the folder. PDFs without a DOI are skipped.
 *
 * Configuration: VAULT_GOODNOTES_DIR and STATE_DIR in ~/.goodnotes-sync/config, the same file
 * the sync script reads. They can be overridden with the Zotero prefs
 * extensions.goodnotes-sync.goodnotesDir and extensions.goodnotes-sync.stateDir.
 * Manual run: Tools > Developer > Run JavaScript  ->  await Zotero.GoodNotesSync.run()
 */
var GNS = null;
const P = 'extensions.goodnotes-sync.';

function homeDir() {
  try { return Services.dirsvc.get('Home', Components.interfaces.nsIFile).path; } catch (e) {}
  try { return PathUtils.homeDir; } catch (e) {}
  return '';
}

async function readConfig() {
  const home = homeDir();
  const cfg = {};
  try {
    const text = await IOUtils.readUTF8(home + '/.goodnotes-sync/config');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
      if (m) cfg[m[1]] = m[2].replace(/\$\{?HOME\}?/g, home).replace(/^~(?=\/)/, home);
    }
  } catch (e) {}
  const base = Zotero.Prefs.get(P + 'goodnotesDir', true) || cfg.VAULT_GOODNOTES_DIR || '';
  const state = Zotero.Prefs.get(P + 'stateDir', true) || cfg.STATE_DIR || (home + '/.goodnotes-sync/state');
  return { BASE: base.replace(/\/+$/, ''), MOVES: state + '/moves.tsv', LOG: state + '/zotero-log.txt' };
}

async function log(cfg, msg) {
  Zotero.debug('[GoodNotes Sync] ' + msg);
  if (!cfg) return;
  try {
    const d = new Date(), z = n => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
    await IOUtils.writeUTF8(cfg.LOG, `${ts} ${msg}\n`, { mode: 'appendOrCreate' });
  } catch (e) { Zotero.debug('[GoodNotes Sync] log error ' + e); }
}

const dirOf = rel => rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';

async function listPdfs(dir) {
  let out = [];
  let kids = [];
  try { kids = await IOUtils.getChildren(dir); } catch (e) { return out; }
  for (const k of kids) {
    const name = k.split('/').pop();
    if (name.startsWith('.')) continue;
    let st; try { st = await IOUtils.stat(k); } catch (e) { continue; }
    if (st.type === 'directory') out = out.concat(await listPdfs(k));
    else if (name.toLowerCase().endsWith('.pdf')) out.push(k);
  }
  return out;
}

function findCollection(L, path) {
  let parent = false, c = null;
  for (const n of path.split('/')) {
    c = Zotero.Collections.getByLibrary(L, true).find(x => x.name === n && (x.parentID || false) === parent);
    if (!c) return null;
    parent = c.id;
  }
  return c;
}

async function getOrCreateCollection(cfg, L, path) {
  let parent = false, c = null;
  for (const n of path.split('/')) {
    c = Zotero.Collections.getByLibrary(L, true).find(x => x.name === n && (x.parentID || false) === parent);
    if (!c) {
      c = new Zotero.Collection(); c.libraryID = L; c.name = n;
      if (parent) c.parentID = parent;
      await c.saveTx();
      await log(cfg, 'created collection: ' + n);
    }
    parent = c.id;
  }
  return c;
}

async function findByDOI(L, doi) {
  const s = new Zotero.Search(); s.libraryID = L;
  s.addCondition('DOI', 'is', doi);
  const ids = await s.search();
  const items = Zotero.Items.get(ids).filter(i => !i.deleted);
  return items.length ? items[0] : null;
}

async function translateDOI(L, doi) {
  const tr = new Zotero.Translate.Search();
  tr.setIdentifier({ DOI: doi });
  const t = await tr.getTranslators();
  if (!t.length) return null;
  tr.setTranslator(t);
  const its = await tr.translate({ libraryID: L, saveAttachments: false });
  return its && its.length ? its[0] : null;
}

function linkedAtts(all, BASE) {
  return all.filter(i => i.isAttachment() && !i.deleted
    && i.attachmentLinkMode == Zotero.Attachments.LINK_MODE_LINKED_FILE
    && (i.getFilePath() || '').startsWith(BASE + '/'));
}

async function setCollectionForMove(cfg, L, item, oldRel, newRel) {
  const BASE = cfg.BASE;
  const od = dirOf(oldRel), nd = dirOf(newRel);
  if (!item || !nd || nd === od) return;           // moved to the root folder: keep collections
  const nc = await getOrCreateCollection(cfg, L, nd);
  if (!item.inCollection(nc.id)) item.addToCollection(nc.id);
  if (od) {
    const oc = findCollection(L, od);
    const stillThere = item.getAttachments().map(i => Zotero.Items.get(i))
      .some(a => { const p = a.getFilePath() || ''; return p.startsWith(BASE + '/') && dirOf(p.slice(BASE.length + 1)) === od; });
    if (oc && item.inCollection(oc.id) && !stillThere) item.removeFromCollection(oc.id);
  }
  await item.saveTx();
}

async function run() {
  if (!GNS || GNS.running) return;
  GNS.running = true;
  const cfg = await readConfig();
  const { BASE, MOVES } = cfg;
  const L = Zotero.Libraries.userLibraryID;
  const zotmoovPref = 'extensions.zotmoov.enable_automove';
  let paused = false, zotmoovWasOn = false;
  try {
    if (!BASE) { await log(null, 'not configured: set VAULT_GOODNOTES_DIR in ~/.goodnotes-sync/config'); return; }
    if (!(await IOUtils.exists(BASE))) return;
    let atts = linkedAtts(await Zotero.Items.getAll(L), BASE);

    // A) moves and renames recorded by the sync script
    let lines = [];
    try { lines = (await IOUtils.readUTF8(MOVES)).split('\n').filter(Boolean); } catch (e) {}
    const done = Zotero.Prefs.get(P + 'movesDone', true) || 0;
    for (let k = done; k < lines.length; k++) {
      const [o, n] = lines[k].split('\t');
      if (!o || !n) continue;
      const op = BASE + '/' + o, np = BASE + '/' + n;
      for (const a of atts.filter(x => x.getFilePath() === op)) {
        if (atts.some(b => b !== a && b.getFilePath() === np)) { await a.eraseTx(); await log(cfg, 'removed duplicate link: ' + o); continue; }
        await a.relinkAttachmentFile(np);
        await setCollectionForMove(cfg, L, a.parentItem, o, n);
        await log(cfg, 'relinked: ' + o + ' -> ' + n);
      }
      atts = linkedAtts(await Zotero.Items.getAll(L), BASE);
    }
    Zotero.Prefs.set(P + 'movesDone', lines.length, true);

    const pdfs = await listPdfs(BASE);

    // B) broken links: same file name elsewhere in the folder
    for (const a of atts) {
      if (await a.fileExists()) continue;
      const nm = '/' + a.getFilePath().split('/').pop();
      const cands = pdfs.filter(p => p.endsWith(nm));
      if (cands.length === 1 && !atts.some(b => b.getFilePath() === cands[0])) {
        const o = a.getFilePath().slice(BASE.length + 1), n = cands[0].slice(BASE.length + 1);
        await a.relinkAttachmentFile(cands[0]);
        await setCollectionForMove(cfg, L, a.parentItem, o, n);
        await log(cfg, 'repaired link: ' + o + ' -> ' + n);
      }
    }
    atts = linkedAtts(await Zotero.Items.getAll(L), BASE);

    // C) new PDFs in the folder
    const linked = new Set(atts.map(a => a.getFilePath()));
    const ignored = new Set(JSON.parse(Zotero.Prefs.get(P + 'ignored', true) || '[]'));
    const now = Date.now();
    const todo = [];
    for (const p of pdfs) {
      if (linked.has(p) || ignored.has(p)) continue;
      const st = await IOUtils.stat(p);
      const t = Math.max(st.lastModified || 0, st.creationTime || 0);
      if (now - t < 2 * 60 * 1000) continue;        // just appeared: next round
      todo.push(p);
    }
    if (!todo.length) return;

    // ZotMoov would otherwise copy/move the newly linked files: pause it for the import
    zotmoovWasOn = Zotero.Prefs.get(zotmoovPref, true) === true;
    if (zotmoovWasOn) { Zotero.Prefs.set(zotmoovPref, false, true); paused = true; }
    for (const p of todo) {
      const rel = p.slice(BASE.length + 1), dir = dirOf(rel);
      let att = null;
      try {
        att = await Zotero.Attachments.linkFromFile({ file: p });
        let text = '';
        try { text = ((await Zotero.PDFWorker.getFullText(att.id, 2)) || {}).text || ''; } catch (e) {}
        const m = text.match(/\b(10\.\d{4,9}\/[^\s"<>]+)/i);
        if (!m) { await att.eraseTx(); ignored.add(p); await log(cfg, 'skipped (not a paper): ' + rel); continue; }
        const doi = m[1].replace(/[.,;)\]}]+$/, '');
        let item = await findByDOI(L, doi), created = false;
        if (!item) { item = await translateDOI(L, doi); created = !!item; }
        if (!item) { await att.eraseTx(); ignored.add(p); await log(cfg, 'skipped (DOI not found ' + doi + '): ' + rel); continue; }
        att.parentID = item.id; await att.saveTx();
        if (dir) {
          const c = await getOrCreateCollection(cfg, L, dir);
          if (!item.inCollection(c.id)) { item.addToCollection(c.id); await item.saveTx(); }
        }
        await log(cfg, (created ? 'new paper: ' : 'linked to existing paper: ') + rel + ' [' + doi + ']');
      } catch (e) {
        await log(cfg, 'error with ' + rel + ': ' + e);
        try { if (att && !att.parentID) await att.eraseTx(); } catch (e2) {}
      }
    }
    Zotero.Prefs.set(P + 'ignored', JSON.stringify([...ignored]), true);
  } catch (e) {
    await log(cfg, 'error: ' + e);
  } finally {
    if (paused) {
      await Zotero.Promise.delay(8000);
      Zotero.Prefs.set(zotmoovPref, true, true);
    }
    if (GNS) GNS.running = false;
  }
}

async function loop() {
  await Zotero.Promise.delay(60 * 1000);
  while (GNS && GNS.active) {
    await run();
    await Zotero.Promise.delay(5 * 60 * 1000);
  }
}

function install() {}
async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  GNS = { active: true, running: false };
  Zotero.GoodNotesSync = { run };
  await log(await readConfig(), 'started (version ' + version + ')');
  loop();
}
function shutdown() {
  if (GNS) GNS.active = false;
  GNS = null;
  delete Zotero.GoodNotesSync;
}
function uninstall() {}
