# Ringalong Studio

A browser-based handbell arrangement editor.
Song content is processed on the user's device, not uploaded to a server.

## Run

Requires Node.js 22.12+ (Node.js 24 recommended) and npm.

```powershell
npm ci
npm run dev
```

Open the localhost URL printed by Vite. To create a static deployment:

```powershell
npm run build
```

Publish only the contents of `dist/` to a static HTTPS host. Do not publish this
repository's existing song JSON, generated HTML, or photographs. There is no backend
or upload endpoint. All application dependencies and fonts are bundled locally;
no CDN, analytics, or external syllabification service is used. Recovery is scoped
to the site's browser origin, so use a consistent local port to find the same draft.

## Editing

1. Optionally enter a hymn number and choose **Look up**, or enter the title
   and key signature yourself. Set meter and pickup beats. Configure the bell set and
   ringing options under **Bells & ringing**.
2. Add a verse, chorus, bridge, or named section. Enter one lyric line per line,
   keeping punctuation attached to its word. Spaces delimit lyric tokens.
3. Choose **Next**. Local English hyphenation suggestions can be reviewed and
   corrected before accepting them. These are typographic suggestions, not a
   reliable guide to how every word should be sung.
4. Select note length, melody, chord, and ringing under each word. Palettes are
   horizontally scrollable. Arrow keys move among palette choices; Enter selects.
   Note length, melody, and chord selections advance to the next musical event.
   The read-only bell row updates immediately: filled badges strike; outlined badges
   are held without another strike. A held-only event shows outlines, not "No strikes".
5. **Done** creates a compact view; **Edit** reopens the controls. New sections of
   the same type share their musical pattern. Use the left navigation to switch lyrics;
   there is no duplicate verse dropdown. Each navigation row has up/down and delete
   controls; the first up and last down controls are disabled. They act on their own
   section without changing the open editor. The pencil immediately after the section
   title renames it. Names/numbers are saved, not derived
   from list position: deleting Verse 2 leaves Verse 3 and Verse 4 unchanged. New
   sections use one higher than the highest remaining number of the same type.
6. **Preview** refreshes the conductor-first score below the editor. **Save / Export**
   downloads a standalone HTML file without ending the editing session. Ctrl/Cmd+S
   also exports. Supporting browsers show a native Save As dialog; other browsers
   use downloads, whose prompts follow the browser's download settings.

Export checks whether the musical content is valid, not whether every editor is
closed with Done. Another verse left open in music mode does not block saving.
Unmapped lyric/syllable drafts still need preparation; the error identifies their
saved section names and directs you to Next/confirm rather than incorrectly asking
you to click Done again.

Attribution is the single editable multiline credit field in Song details. New songs
start with `Words:` and `Music:` lines. Legacy author fields are merged into those
lines on import, without duplicating existing credits; `Copyright:` labels are
capitalized. The complete attribution, including setting, source and license notices,
persists in recovery and exports.

Individual bell tabs show lyric lines in player-sheet format: boxed words
indicate strikes, underlined words indicate damping, and unmarked words need no
action. These parts omit measures, note lengths, melody labels, and chords in both
preview and exported HTML.

The conductor groups all prepared sections of the same type into one block, in
first-appearance order. Within each musical line, chord names run across the top,
followed by one aligned lyric row per verse, then the bell markers. Verses are
numbered on their first line. Filled bell markers mean strike; hollow outlined
markers mean sustain. No duration icons, damping annotations, or separate melody
labels appear on the conductor. Different subdivisions align by exact musical time;
verse-specific chord or ringing differences are numbered within the same block.
The final horizontal play-count row totals actual strikes for each available bell across
all prepared section instances, including repeated choruses, and includes zero
counts. Visual sustain markers do not add plays. Individual bell parts remain in
performance order and are not combined. Preview and exports share this renderer.

Printed conductor lyric rows use 0.75px top/bottom padding (screen remains 3px).
Decimal labels such as Verse 3.5 print compactly as 3.5; custom names receive a
wider first-line label column instead of wrapping vertically in a number-width gutter.

The sun/moon icon in the top toolbar switches between light and dark palettes,
including the editor, controls, and score preview. A `ringalong-theme` cookie stores
only that preference for one year; it contains no song content. Before an explicit
choice, the system's preferred color scheme is used. Printing always uses the light
palette. All component and bell colors are variables defined for both modes in
`web/src/theme.css`; exported files include the shared palettes and default to light.

The initial duration, melody, and chord values are editable starting defaults,
not an automatic transcription. Key signature changes do not transpose notes.
Section order is performance order; the up/down controls reorder sections.

## Bells and Melody Mode

There is one **Bells** set, authoritative for playback, display, and validation.

- **Melody mode off:** play chords only. Bell octaves are interchangeable; C4 and
   C5 collapse into one C player part/count. Enter either pitch names or pitches with
   octaves. Note labels, palette choices, conductor badges, player pages, counts and
   printouts show pitch names only. Out-of-chord melody notes are not added.
- **Melody mode on:** play melody plus chord accompaniment. Supply exact octave
   pitches such as C4/C5. Different octaves have separate player tabs, pages and
   counts, with the full pitch visible on screen and in print. Missing melody bells
   are reported; they are not silently replaced by the nearest pitch. Stored melody
   data is retained when changing modes. Existing single-pitch-class melodies can
   resolve only when one available octave matches; ambiguous ones need an octave.

**Combined notes** gives one player to two bells. Use **Add pair** and choose a bell in each
dropdown (the trash icon removes a pair). Each pair adds a sheet after the individual bell
sheets, with both bell squares on the title line in the order you chose them. A struck word is
boxed in its bell's color, with the first bell's box around the second's, and the note names are
printed above the box. A damped word is underscored in each bell's color, the first bell's mark
below the second's. Choosing the same bell twice, or a pair already listed, is rejected.

Custom chords accept arrays or a space-separated JSON string, for example:

```json
{"Csus4": "C5 F5 G5"}
```

Csus4 contains C, F and G (not E). Custom chord tones describe harmony, so octaves
in the chord definition are accepted but do not change the required melody octave.
Chord mode displays the example and editor values without octave numbers.

Legacy imports normalize source pitches with the legacy mapping once for compatibility;
subsequent melody-mode edits are strict.

## Load From Web

The compact hymn-number field precedes the title, with **Look up** beside it. Lookup
supports The United Methodist Hymnal (1989) and The Faith We Sing (2000). Enter
`378` or `UMH 378` for UMH, or `2062`, `TFWS 2062`, or `FWS 2062` for TFWS.
Plain numbers 1-962 select UMH; 2001-2284 select TFWS. An explicit prefix limits
matching to that book. Enter also starts lookup.
A popup identifies the hymnal, title, tune, source edition, and rights status. When
multiple hymnal/setting matches exist, choose the appropriate one there. Cancel
leaves the arrangement unchanged. Loading over existing work requires confirmation.

Initial reviewed catalog:

| Hymnal / Number | Hymn | Source Tune |
| --- | --- | --- |
| UMH 57 | O For a Thousand Tongues to Sing | AZMON |
| UMH 64 | Holy, Holy, Holy! Lord God Almighty | NICAEA |
| UMH 98 | To God Be the Glory | TO GOD BE THE GLORY |
| UMH 139 | Praise to the Lord, the Almighty | LOBE DEN HERREN |
| UMH 378 | Amazing Grace | NEW BRITAIN |
| TFWS 2062 | The Lily of the Valley | SALVATION |
| TFWS 2212 | My Life Flows On (How Can I Keep from Singing) | ENDLESS SONG |

This is deliberately not a claim that either hymnal is fully available or public domain.
Unsupported numbers report the available coverage and offer an external Hymnary
reference link without changing your document. Opening that link sends only the
hymnal and hymn number, not your arrangement. Restricted texts and settings are
not automatically imported; use only content you are authorized to supply.
TFWS number/title cross-references were checked against
[HymnSite's TFWS index](https://www.hymnsite.com/fws/index.shtml), which separately
lists public-domain text and MIDI availability. A text or MIDI listing alone does
not make the entire hymnal setting importable.
The number cross-reference identifies a hymn/tune, not a licensed reproduction of
either hymnal printing: lyrics, keys, verse counts, rhythms and harmonization can differ.
The imported settings come from the Open Hymnal June 2014 ABC collection and,
for TFWS 2212, its separately published 2026 ABC score. Their individual source
files explicitly state `copyright: public domain`. That status
uses United States law; users elsewhere must check their applicable rights.

ABCJS parses the source music locally. Melody pitches, durations, lyric alignment,
meter, pickup and source attribution are imported; harmony is inferred from the
source voices at melody onsets and requires review. Tied continuations sustain
instead of striking again. The imported music opens in edit mode. Verses supplied
as unaligned text are preserved as lyric drafts for manual review/alignment, not
silently discarded. Sources with repeats or key/meter changes needing expansion
are rejected rather than approximated. Bell selection can retain your current set
or initialize a source-appropriate set. In melody mode, a retained set must provide the source's
required melody octaves; missing notes are reported instead of substituted.

The browser fetches reviewed ABC files and their catalog from the app's own static
`hymns/` directory, not from Hymnary or an arbitrary external URL. This avoids blocked
scraping, mixed HTTP/HTTPS content, and missing CORS headers. Only approved public
sources are distributed; user arrangements are never uploaded. Source provenance
and rights travel with the exported document. ABCJS is loaded only when needed.

Maintainers use two separate commands to discover candidate scores and regenerate
the checked-in catalog.

```powershell
npm run catalog:candidates
```

`catalog:candidates` scans the published Open Hymnal ABC collection and adds new,
unique public-domain candidates to `scripts/hymn-number-mappings.json` as rows with
`hymnal: "unmapped"`, `number: ""`, and `tune: ""`. This command updates only the
mapping file; it does not regenerate the site catalog. Open Hymnal score IDs do not
identify UMH or TFWS numbers, so verify a candidate's number, tune, and rights before
replacing those placeholder values.

After reviewing or editing mappings, regenerate the catalog and eligible score files:

```powershell
npm run catalog:refresh
```

This command skips unmapped rows and includes a mapped hymn only when its current
score has an explicit, unambiguous public-domain notice. Missing, restricted, or
ambiguous notices exclude a mapping. Neither command runs during builds or tests.
A local editor for the unmapped rows is available while `npm run dev` is running at
`/admin/hymns/`. It lists unmapped hymns with a filter, lets you enter the hymnal, number
and tune (with a Hymnary search link), saves to `scripts/hymn-number-mappings.json`, and has
**Rescan for hymns** and **Update catalog** buttons that run the two commands above. It
exists only on the dev server, accepts only localhost requests, and is not part of the build.

Review rights, number/tune mapping, words, translation, melody, and arrangement before
checking in refreshed files. Source files and the generated catalog are copied into
`dist/hymns/` for static deployment.

## Verse Variations

**Shared music** edits update all sections of that type. **This verse only** creates
duration, melody, and chord exceptions for the selected verse. Ringing policies,
melody-ringing overrides, omitted bells, and breaths always belong to shared music.

Select a lyric cell to edit its text, split or join syllables, assign another word,
or add a continuation note. The note edit panel appears directly above the line
being edited and follows the selected note, including when entry advances to a
different line. Add note here, Break line here, and Reset/Remove note are grouped
along the panel's right edge. A shared note can contain multiple verse-specific
subdivisions. Their durations must add up to the shared note's duration. Extra words in a
new verse initially subdivide the final lyric-bearing note on that line; remap them as needed.
Unassigned/duplicated words and mismatched timing must be fixed before Done/export.
Different lyric line counts require matching the shared pattern's line structure.

- **Continue syllable**: play a note without consuming another word.
- **Not used in this verse**: keep the time and previous sounding bells, without
  striking, damping, or changing the chord.
- **Rest**: damp sounding bells and keep the time.
- **Add note here**: insert a shared untexted note after the selected note in every
   section of that type.
- **Split note**: subdivide only the selected verse's current note without adding time.
- **Break line here**: select a note, then use the control on the panel's right edge.
   The selected shared note and everything to its right move to the beginning of
   the next line, creating a new final line if needed. All linked musical verses
   move their corresponding lyrics together. Notes, durations, chords, ringing,
   breaths, lyric mappings and verse exceptions are preserved; timing and note order
   do not change. Undo/Redo reverses/restores the break. The control is disabled at
   an existing line start. For a subdivided note, select its first subdivision;
   the shared note and all its subdivisions move together. Unprepared lyric drafts
   remain unchanged and can be aligned to the updated shared layout when continued.
- **Reset note**: when a note contains a lyric in any linked verse, reset its shared
   music to the same defaults as a new note, clear music exceptions, and keep every
   word and lyric mapping. Existing subdivisions divide the default duration equally.
- **Remove note**: delete a shared note only if no linked verse assigns it a lyric.
   Extra untexted subdivisions can be removed without deleting their shared note;
   their duration is merged into a neighboring subdivision. Lyric-bearing extra
   notes reset rather than deleting words.

Shared ringing policies are Auto, Full chord, Melody only, Hold, and Rest. A shared
override applies to the first played subdivision; later subdivisions follow automatic
rules unless Hold/Rest suppresses the entire shared note. A shared breath belongs only after
the final subdivision. Reset restores verse-specific music without discarding lyrics.

Durations and pickup are in denominator-beats. An eighth note is 0.5 beats in 4/4 and
1 beat in 6/8. Pickup means the length of the
opening incomplete measure, not a count-in. Each section restarts the pickup and
sounding state. Exact rational arithmetic determines bars. Cross-measure notes show
a boundary/continuation mark without introducing a second strike. Automatic strong
beat rules use the event's starting beat, including fractional beats.

## Import and Export

Import accepts the original JSON format and new exported HTML. It does not reconstruct
source data from older HTML files without embedded JSON. HTML import reads only the
`script#ringalong-data[type="application/json"]` element and never executes imported
scripts or trusts imported styles/assets. Files are limited to 8 MB.

The new source format has `format: "ringalong"` and `version: 1`, UUID-based pattern,
slot, section and token IDs, shared patterns, per-section lyric bindings, and optional
verse-specific subdivisions. Legacy custom chords, credits, excluded bells, word
overrides, and wordless events are retained. The original legacy object is preserved
in an inert extensions field. Unsupported future source
versions are rejected. Exported HTML embeds source JSON, score styles, music font,
font license, and tab/print behavior, so it opens offline without the editor.

## Privacy and Recovery

Local recovery is enabled by default and stores one draft, including lyrics and
unfinished edits, in browser localStorage. It is not cloud storage. Disable recovery
to remove that draft and stop future storage. **Clear draft** removes the saved
draft without clearing the current editor; subsequent edits can create a new draft.
Storage denial or quota errors do not prevent editing or exporting. Switching
sections and previewing retain unfinished work. Export regularly for durable backups.

Exported files and browser recovery both retain song content on the user's device.
Client-only processing does not grant permission to reproduce or distribute lyrics;
users remain responsible for applicable copyright permissions and licensing.

## Verification

```powershell
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Routine tests exclude the Open Hymnal lookup/import suites. The regular browser
suite blocks all non-local HTTP requests. Neither normal tests nor a build contacts
the upstream hymn service or refreshes the catalog.

Only after explicitly changing the hymn-service integration, run its opt-in suites:

```powershell
npm run test:hymns
npm run test:e2e:hymns
```

These are configured separately in `vitest.hymns.config.ts` and
`playwright.hymns.config.ts`. They use the checked-in public-domain catalog and mocked
responses; even the opt-in browser suite blocks external HTTP requests. The only
upstream downloads are the separately invoked `npm run catalog:candidates` and
`npm run catalog:refresh` maintenance commands. Neither runs during routine builds
or tests.

Browser tests cover desktop/mobile editing, shared verses and exceptions, syllables,
recovery, offline HTML downloads, and import/export round trips. Artifacts and
screenshots are under ignored `test-results/`; no new lyric fixtures are needed.

## Dependencies

TypeScript/Vite, Zod, fraction.js, ABCJS, hyphen (local US English patterns), and Lucide;
DM Sans, Fraunces, and Noto Music are bundled via Fontsource. A production build emits
`THIRD_PARTY_NOTICES.txt` containing the installed direct dependency license notices.
Exported HTML includes Noto Music's complete SIL Open Font License in an inert template.
No audio, MIDI, cloud accounts, automatic transcription, or transposition is included.