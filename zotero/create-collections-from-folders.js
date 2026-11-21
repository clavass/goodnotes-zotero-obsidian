// Creates Zotero collections that mirror the folder tree of your GoodNotes folder.
// Run it once in Zotero: Tools > Developer > Run JavaScript, tick "Run as async function",
// paste this file, set FOLDER below, press Run.
// Existing collections with the same name and parent are reused, never duplicated.

const FOLDER = "/Users/YOUR_USER/Library/Mobile Documents/iCloud~md~obsidian/Documents/YourVault/GoodNotes";

const L = Zotero.Libraries.userLibraryID;
const made = [];

async function walk(dir, rel, out) {
  for (const p of await IOUtils.getChildren(dir)) {
    const name = p.split('/').pop();
    if (name.startsWith('.')) continue;
    if ((await IOUtils.stat(p)).type === 'directory') {
      const r = rel ? rel + '/' + name : name;
      out.push(r);
      await walk(p, r, out);
    }
  }
  return out;
}

for (const path of await walk(FOLDER, '', [])) {
  let parent = false;
  for (const n of path.split('/')) {
    let c = Zotero.Collections.getByLibrary(L, true)
      .find(x => x.name === n && (x.parentID || false) === parent);
    if (!c) {
      c = new Zotero.Collection(); c.libraryID = L; c.name = n;
      if (parent) c.parentID = parent;
      await c.saveTx();
      made.push(path);
    }
    parent = c.id;
  }
}
return made.length + " collections created:\n" + made.join("\n");
