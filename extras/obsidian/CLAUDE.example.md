# Instructions for AI assistants — example

Put a file like this at the root of your vault (as `CLAUDE.md`, or whatever your assistant reads)
so that any assistant working in the vault knows how the sync works. Adapt names and paths.

## `GoodNotes/` folder — synced with Google Drive and GoodNotes
- It mirrors the GoodNotes Auto Backup folder on Google Drive, via `goodnotes-sync.sh` (cron, every 5 minutes).
- Drive → vault: new or changed PDFs are copied to the same path. PDFs removed from Drive go to the macOS Trash.
- Moves/renames done in GoodNotes are detected: links in notes are updated, Zotero is relinked.
- PDFs **added** to `GoodNotes/` (by hand or by Zotero/ZotMoov) are e-mailed to GoodNotes and land in its root folder.
  The GoodNotes backup brings them back under another name (`X.pdf (1).pdf`, `X.pdf.pdf`): the script keeps that copy and trashes the original.
- So, for assistants:
  - **Do not edit, rename or move** PDFs inside `GoodNotes/`: they would be overwritten or trashed.
  - **Adding** a PDF there sends it to GoodNotes: only do it when asked.
  - Notes about PDFs go **outside** `GoodNotes/`, with a link such as `[[GoodNotes/Folder/Paper.pdf]]`.

## Zotero
- Collections mirror the `GoodNotes/` folders (same names, same nesting).
- ZotMoov (mode Move, subfolder `{%c}`) puts PDFs saved with Zotero Connector into `GoodNotes/<collection>/` and keeps them as linked files.
- The "GoodNotes Sync" Zotero plugin links new papers found in `GoodNotes/` (by DOI), relinks after moves/renames and keeps collections aligned. Log: `~/.goodnotes-sync/state/zotero-log.txt`.

## Notes
- `Sources/` → one note per paper, created with Zotero Integration (format "Source"). Write your own comments only in **My notes**: the rest is rewritten on re-import.
- `Topics/` → one note per topic. `Thoughts/` → own ideas. `Maps/` → index notes. `Templates/` → templates only.
- Do not change `.obsidian/` unless asked.
