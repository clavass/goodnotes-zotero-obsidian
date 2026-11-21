#!/bin/sh
# goodnotes-sync.sh — keeps a GoodNotes backup folder (Google Drive) and an Obsidian vault folder in sync.
#
#  Drive -> Obsidian : new or changed PDFs are copied to the SAME path in the vault (empty folders too).
#                      PDFs that came from Drive and later disappear from it go to the macOS Trash.
#                      Moves/renames done in GoodNotes are detected: links in your notes are updated
#                      and the change is written to moves.tsv (read by the Zotero plugin).
#  Obsidian -> GoodNotes : PDFs added to the vault folder (by hand or by Zotero/ZotMoov) are e-mailed
#                      to your "Email to Goodnotes" address (they land in the GoodNotes root folder).
#  Round trip        : when GoodNotes backs up such a PDF under a different name (e.g. "X.pdf (1).pdf"
#                      or "X.pdf.pdf"), the GoodNotes copy is kept and the original goes to the Trash.
#
# Configuration: ~/.goodnotes-sync/config (see config.example). Run it every 5 minutes with cron.
# macOS only. Uses only tools that ship with macOS (sh, find, perl, awk, md5, osascript + Mail).

CONFIG="${GOODNOTES_SYNC_CONFIG:-$HOME/.goodnotes-sync/config}"
[ -r "$CONFIG" ] || { echo "Missing config: $CONFIG" >&2; exit 1; }
. "$CONFIG"

SRC="$DRIVE_GOODNOTES_DIR"
DST="$VAULT_GOODNOTES_DIR"
VAULT="$(dirname "$DST")"
FOLDER="$(basename "$DST")"
STATE="${STATE_DIR:-$HOME/.goodnotes-sync/state}"
TRASH="${TRASH_DIR:-$HOME/.Trash/goodnotes-sync}"
SYNCED="$STATE/from-drive.txt"    # PDFs this script copied from Drive
SENT="$STATE/sent.txt"            # PDFs added in the vault and already e-mailed to GoodNotes
MOVES="$STATE/moves.tsv"          # old<TAB>new (paths inside the vault folder), for Zotero
NEW="$STATE/.new-$$"              # PDFs that appeared during this run: path<TAB>md5
LOG="$STATE/log.txt"
MAXB=$((25*1024*1024))            # size limit of Email to Goodnotes

[ -n "$SRC" ] && [ -n "$DST" ] || { echo "Set DRIVE_GOODNOTES_DIR and VAULT_GOODNOTES_DIR in $CONFIG" >&2; exit 1; }
/bin/mkdir -p "$STATE"; /usr/bin/touch "$SYNCED" "$SENT" "$MOVES"

# one run at a time (prevents double e-mails)
LOCK="$STATE/.lock"
if ! /bin/mkdir "$LOCK" 2>/dev/null; then
  [ -n "$(/usr/bin/find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ] || exit 0
  /bin/rmdir "$LOCK"; /bin/mkdir "$LOCK" || exit 0
fi
trap '/bin/rm -f "$NEW"; /bin/rmdir "$LOCK" 2>/dev/null' EXIT
: > "$NEW"

inlist() { /usr/bin/grep -qxF -- "$1" "$2"; }
addto()  { inlist "$1" "$2" || printf '%s\n' "$1" >> "$2"; }
delfrom(){ /usr/bin/grep -vxF -- "$1" "$2" > "$2.tmp"; /bin/mv "$2.tmp" "$2"; }
log()    { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M')" "$1" >> "$LOG"; }
md5of()  { if [ -x /sbin/md5 ]; then /sbin/md5 -q "$1"; else md5sum "$1" | cut -d' ' -f1; fi; }
fsize()  { if [ "$(uname)" = Darwin ]; then /usr/bin/stat -f %z "$1"; else stat -c %s "$1"; fi; }
fflags() { /usr/bin/stat -f %Sf "$1" 2>/dev/null; }
# "base" name: no folder, no ".pdf", no repeated " (1)"
basenm() { /usr/bin/perl -e '$_=shift; s{.*/}{}; 1 while s/\.pdf$//i || s/ \(\d+\)$//; print' "$1"; }

# update links in the notes (outside the mirrored folder and .obsidian/) and record the move for Zotero
moved() {   # $1 old, $2 new (relative to the vault folder, no "./")
  printf '%s\t%s\n' "$1" "$2" >> "$MOVES"
  log "moved/renamed: $1 -> $2"
  on=$(basename "$1"); nn=$(basename "$2")
  ( cd "$VAULT" && /usr/bin/find . -name '*.md' -not -path "./$FOLDER/*" -not -path './.obsidian/*' -print0 \
    | /usr/bin/xargs -0 /usr/bin/grep -lF -e "$FOLDER/$1" -e "[[$on" 2>/dev/null \
    | while IFS= read -r note; do
        F="$FOLDER" OLD="$1" NEW="$2" ON="$on" NN="$nn" /usr/bin/perl -pi -e \
          's{\Q$ENV{F}/$ENV{OLD}\E}{$ENV{F}/$ENV{NEW}}g; s/\Q[[$ENV{ON}\E/[[$ENV{NN}/g' "$note"
        log "  links updated in: $note"
      done )
}

send_to_goodnotes() {   # $1 = absolute path of the PDF
  if [ "${DRYRUN:-0}" = 1 ]; then echo "[dry run] would send: $1"; return 0; fi
  [ -n "$GOODNOTES_EMAIL" ] || return 1               # sending disabled
  /usr/bin/osascript - "$1" "$GOODNOTES_EMAIL" >/dev/null <<'OSA'
on run argv
  set f to POSIX file (item 1 of argv)
  tell application "Mail"
    set m to make new outgoing message with properties {subject:"GoodNotes import", content:" ", visible:false}
    tell m
      make new to recipient at end of to recipients with properties {address:(item 2 of argv)}
      make new attachment with properties {file name:(f as alias)} at after last paragraph of content
    end tell
    delay 2
    send m
  end tell
end run
OSA
}

cd "$SRC" 2>/dev/null || exit 0                     # Drive not ready: touch nothing
N=$(/usr/bin/find . -type f -name '*.pdf' | wc -l)
[ "$N" -gt 0 ] || exit 0                            # empty/unreadable folder: touch nothing

# 0) Drive folders in the vault (empty ones too)
/usr/bin/find . -mindepth 1 -type d | while IFS= read -r d; do /bin/mkdir -p "$DST/$d"; done

# 1) Drive -> Obsidian: new and changed PDFs
/usr/bin/find . -type f -name '*.pdf' | while IFS= read -r f; do
  case "$(fflags "$f")" in
    *dataless*) /bin/cat "$f" >/dev/null 2>&1        # ask Drive to download it
                case "$(fflags "$f")" in *dataless*) continue ;; esac ;;
  esac
  isnew=0; [ -e "$DST/$f" ] || isnew=1
  if [ "$isnew" = 1 ] || [ "$f" -nt "$DST/$f" ] || [ "$(fsize "$f")" != "$(fsize "$DST/$f")" ]; then
    d="$DST/$(dirname "$f")"; /bin/mkdir -p "$d"
    tmp="$d/.sync-$$.tmp"
    /bin/cp -p "$f" "$tmp" && /bin/mv -f "$tmp" "$DST/$f" || continue
  fi
  addto "$f" "$SYNCED"
  inlist "$f" "$SENT" && delfrom "$f" "$SENT"       # the sent PDF came back on the same path
  if [ "$isnew" = 1 ]; then
    printf '%s\t%s\n' "$f" "$(md5of "$DST/$f")" >> "$NEW"
    # is it a sent PDF coming back from GoodNotes under another name?
    b=$(basenm "$f")
    /bin/cat "$SENT" | while IFS= read -r s; do
      [ "$(basenm "$s")" = "$b" ] && [ -e "$DST/$s" ] || continue
      t="$TRASH/$(date +%Y-%m-%d_%H%M)/$(dirname "$s")"; /bin/mkdir -p "$t"
      /bin/mv -f "$DST/$s" "$t/" && delfrom "$s" "$SENT"
      moved "${s#./}" "${f#./}"
      log "back from GoodNotes: ${s#./} -> ${f#./} (original moved to Trash)"
      break
    done
  fi
done

# 2) PDFs in the vault that are not on Drive
cd "$DST" 2>/dev/null || exit 0
/usr/bin/find . -type f -name '*.pdf' | while IFS= read -r f; do
  [ -e "$SRC/$f" ] && continue
  if inlist "$f" "$SYNCED"; then                    # came from Drive, then removed/moved in GoodNotes
    h=$(md5of "$f"); g=""
    g=$(/usr/bin/awk -F'\t' -v h="$h" '$2==h{print $1; exit}' "$NEW")
    if [ -z "$g" ]; then                            # same name in another folder (a move)
      bn=$(basename "$f")
      c=$(/usr/bin/awk -F'\t' -v b="/$bn" 'substr($1,length($1)-length(b)+1)==b{print $1}' "$NEW")
      [ "$(printf '%s\n' "$c" | /usr/bin/grep -c .)" = 1 ] && g="$c"
    fi
    t="$TRASH/$(date +%Y-%m-%d_%H%M)/$(dirname "$f")"; /bin/mkdir -p "$t"
    /bin/mv -f "$f" "$t/" && delfrom "$f" "$SYNCED"
    if [ -n "$g" ]; then moved "${f#./}" "${g#./}"; else log "removed in GoodNotes: ${f#./} (moved to Trash)"; fi
  elif inlist "$f" "$SENT"; then                    # already sent: wait for it to come back
    :
  elif [ "$(fsize "$f")" -le "$MAXB" ]; then        # added in the vault (by hand or by Zotero)
    send_to_goodnotes "$DST/$f" && [ "${DRYRUN:-0}" != 1 ] && { addto "$f" "$SENT"; log "sent to GoodNotes: ${f#./}"; }
  else
    log "too large for Email to Goodnotes (over 25 MB): ${f#./}"
  fi
done

# 3) empty folders that no longer exist on Drive
/usr/bin/find . -mindepth 1 -depth -type d | while IFS= read -r d; do
  [ -d "$SRC/$d" ] || /bin/rmdir "$d" 2>/dev/null
done
exit 0
