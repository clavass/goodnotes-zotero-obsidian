# Extras (optional)

Not needed for the sync to work, but useful. Take what you like.

## `obsidian/` — a way to organise your notes

A simple structure that keeps what papers say apart from what you think:

| Folder | Holds | Template |
|---|---|---|
| `Sources/` | one note per paper, created from Zotero | `../obsidian/Zotero - Source.md` (in the main folder) |
| `Topics/` | one note per topic: what several papers say about it, with links to them | `Topic.md` |
| `Thoughts/` | your own ideas and hypotheses | `Thought.md` |
| `Maps/` | index notes that connect topics | `Map.md` |

To use it: create those folders in your vault, copy the templates into your `Templates/` folder,
and insert them with **Cmd+P → Templates: Insert template**.

- `Papers dashboard.md` — lists of papers to read, being read, recently changed and grouped by topic.
  Copy it into your vault. Needs the **Dataview** community plugin, and the folder names above.
  In each paper note, set `status` (to read / reading / read) and `topics` (links to Topic notes, e.g. `["[[Working memory]]"]`).
- `CLAUDE.example.md` — if you use an AI assistant inside your vault (Claude Code or similar), adapt this file
  and save it as `CLAUDE.md` at the vault root: it explains the sync rules, so the assistant does not break them
  (for example by renaming PDFs in the synced folder).

## `build-zotero-plugin.sh`

Rebuilds `zotero/goodnotes-sync-<version>.xpi` from `zotero/manifest.json` and `zotero/bootstrap.js`.
Only needed if you change the plugin's code. Run it in Terminal: `sh extras/build-zotero-plugin.sh`.
