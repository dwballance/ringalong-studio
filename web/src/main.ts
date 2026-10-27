import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/fraunces/500.css';
import '@fontsource/noto-music/400.css';
import './theme.css';
import './styles.css';
import './score.css';
import { createIcons, BellRing, Plus, Download, Upload, Undo2, Redo2, Music2, Eye, Pencil, Check,
  X, ChevronUp, ChevronDown, Trash2, ArrowRight, FilePlus2, Settings2, Scissors, Link2, RotateCcw, ShieldCheck, Moon, Sun, Globe, CornerDownLeft } from 'lucide';
import { hyphenateSync } from 'hyphen/en-us';
import Fraction from 'fraction.js';
import { alignSection, breakLineHere, chordDefinitionsSchema, ensureSectionNames, id, newNote, newSection, newSong, normalizeAttribution, removeUntextedNote, restoreHymnDefaults, sectionTitle, type Song, type Section, type Note, type Binding } from './document';
import { COLORS, DURATIONS, bellLabel, bellPitch, chordTones, durationLabel, eventsFor, midi, noteName, pc, playableBells, perform, problems, resolveBell, type Event } from './music';
import { bindScore, escape as esc, scoreMarkup } from './render';
import { downloadSong, MAX_FILE_SIZE, readDocument } from './files';
import { Recovery } from './recovery';
import { applyTheme, currentTheme, initializeTheme } from './theme';
import { hymnReference, loadHymn, loadHymnCatalog, matchingHymns, type HymnSource } from './hymns';
import { chooseHymn } from './hymn-dialog';

initializeTheme();
const app = document.querySelector<HTMLElement>('#app')!;
const recovery = new Recovery();
const restored = recovery.restore();
let song = normalizeAttribution(ensureSectionNames(restored || newSong()));
let selected = song.sections[0]?.id || '';
let verseOnly = false;
let savedSource = restored ? '' : JSON.stringify(song);
let recoveryDirty = false;
let previewed = false;
let message = restored ? 'Local draft restored.' : '';
let messageIsError = false;
let textEditName = '';
let loadingHymn = false;
let draftPairs: string[][] = [];
let palette: { slotId: string; bindingId: string; field: 'duration' | 'melody' | 'chord' | 'ring' | 'lyric' } | undefined;
const past: string[] = [];
const future: string[] = [];
const icon = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const icons = { BellRing, Plus, Download, Upload, Undo2, Redo2, Music2, Eye, Pencil, Check, X,
  ChevronUp, ChevronDown, Trash2, ArrowRight, FilePlus2, Settings2, Scissors, Link2, RotateCcw, ShieldCheck, Moon, Sun, Globe, CornerDownLeft };
function themeButton() {
  const dark = currentTheme() === 'dark';
  return `<button type="button" class="icon-button" data-action="toggle-theme" aria-label="Toggle dark mode" aria-pressed="${dark}" title="Switch to ${dark ? 'light' : 'dark'} mode">${icon(dark ? 'sun' : 'moon')}</button>`;
}
const command = (action: string, label: string, name: string, style = '', extra = '') =>
  `<button type="button" class="${style}" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${extra}>${icon(name)}<span>${esc(label)}</span></button>`;
const tool = (action: string, label: string, name: string, extra = '') =>
  `<button type="button" class="icon-button" data-action="${action}" title="${esc(label)}" aria-label="${esc(label)}" ${extra}>${icon(name)}</button>`;
const selectedSection = () => song.sections.find(section => section.id === selected);
const selectedPattern = () => song.patterns.find(pattern => pattern.type === selectedSection()?.type);
const meaningful = () => Boolean(song.title.trim() || song.sections.length);

function checkpoint() {
  past.push(JSON.stringify(song)); if (past.length > 60) past.shift(); future.length = 0;
}
function notify(text: string, error = false) {
  message = text; messageIsError = error;
  const notice = document.querySelector<HTMLElement>('#notice');
  if (notice) { notice.textContent = text; notice.classList.toggle('error', error); notice.hidden = !text; }
}
function updateRecoveryStatus() {
  const status = document.querySelector<HTMLElement>('#recovery-status');
  if (status) status.textContent = recovery.error || (recovery.enabled ? recoveryDirty ? 'Saving local draft…' : 'Local recovery on' : 'Local recovery off');
}
function changed(redraw = true) {
  recoveryDirty = true;
  recovery.schedule(song, () => { recoveryDirty = false; updateRecoveryStatus(); });
  if (redraw) render();
}
function edit(action: () => void, redraw = true) { checkpoint(); action(); changed(redraw); }
function sectionLabel(section: Section) {
  return sectionTitle(section);
}
function metadataReady() { return problems({ ...song, sections: [] }, false).length === 0; }
function field(label: string, name: string, value: string | number, extra = '', type = 'text') {
  return `<label class="field ${name === 'title' ? 'title-field' : ''} ${name === 'bells' ? 'bell-field' : ''}"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function metadata() {
  const roots = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
  const keys = ['major', 'minor'].flatMap(mode => roots.map(root => `${root} ${mode}`));
  return `<section class="song-details" aria-labelledby="details-title"><div class="band-heading"><h2 id="details-title">Song details</h2>${song.extensions.hymnDefaults || song.extensions.webSource ? command('reset-hymn', 'Reset hymn', 'rotate-ccw', 'secondary', loadingHymn ? 'disabled' : '') : ''}</div>
    <div class="metadata-grid">
      <div class="field hymn-lookup"><label for="hymn-number">Hymn number <span class="optional">optional</span></label><div class="hymn-lookup-controls"><input id="hymn-number" name="hymnNumber" aria-label="Hymn number" value="${esc(song.hymnNumber)}" placeholder="378" inputmode="numeric" maxlength="50">${command('load-hymn', loadingHymn ? 'Loading…' : 'Look up', 'globe', 'secondary', `aria-busy="${loadingHymn}" ${loadingHymn || !song.hymnNumber.trim() ? 'disabled' : ''}`)}</div></div>
      ${field('Title', 'title', song.title, 'placeholder="Untitled ringalong" required maxlength="250"')}
      <label class="field"><span>Key signature</span><select name="key" required><option value="">Select key</option>${keys.map(key => `<option ${key === song.key ? 'selected' : ''}>${key}</option>`).join('')}</select></label>
      <div class="meter-pickup"><fieldset class="field meter"><legend>Time signature</legend><div><input name="timeTop" type="number" min="1" max="32" value="${song.time[0]}" aria-label="Beats per measure"><span>/</span><select name="timeBottom" aria-label="Beat unit">${[1, 2, 4, 8, 16, 32].map(unit => `<option ${song.time[1] === unit ? 'selected' : ''}>${unit}</option>`).join('')}</select></div></fieldset>
      ${field('Pickup beats', 'pickup', song.pickup, `min="0" max="${song.time[0] - 0.001}" step="any"`, 'number')}</div>
      <label class="field additional-credit"><span>Attribution</span><textarea name="credit" aria-label="Attribution" rows="3" spellcheck="true">${esc(song.credit)}</textarea></label>
    </div>
    <details class="advanced" open><summary>${icon('settings-2')}Bells & ringing<span class="settings-summary">${playableBells(song).length} bells · ${song.time.join('/')} · ${esc(song.key || 'No key')}</span></summary>
      <div class="advanced-grid">
        <fieldset class="ring-mode"><legend>Ringing mode</legend><div>
          <label><input type="radio" name="ringMelody" value="chords" ${song.ringMelody ? '' : 'checked'}><span>Chords</span></label>
          <label><input type="radio" name="ringMelody" value="melody" ${song.ringMelody ? 'checked' : ''}><span>Chords + melody</span></label>
        </div></fieldset>
        ${field('Bells', 'bells', playableBells(song).join(' '), `placeholder="${song.ringMelody ? 'C4 D4 E4 F4 G4 A4 B4 C5' : 'C D E F G A B'}"`)}
        ${combinedNotes()}
        <fieldset class="ring-beats"><legend>Full-chord ringing beats</legend><div>${Array.from({ length: Math.min(32, Math.max(1, song.time[0])) }, (_, index) => `<label><input type="checkbox" data-beat="${index + 1}" ${song.strong.includes(index + 1) ? 'checked' : ''}><span>${index + 1}</span></label>`).join('')}</div></fieldset>
        <label class="field custom-chords"><span>Custom chords <span class="optional">JSON: ${esc(JSON.stringify({ Csus4: song.ringMelody ? 'C5 F5 G5' : 'C F G' }))}</span></span><textarea name="chords" rows="3" spellcheck="false">${esc(JSON.stringify(song.ringMelody ? song.chords : Object.fromEntries(Object.entries(song.chords).map(([name, tones]) => [name, tones.map(noteName)])), null, 2))}</textarea></label>
      </div>
    </details></section>`;
}

function combinedNotes() {
  const bells = playableBells(song);
  const rows = [...song.combined.map(pair => pair.map(note => resolveBell(song, note) ?? '')), ...draftPairs];
  const select = (row: string[], index: number, side: number) => `<select data-pair="${index}" data-side="${side}" aria-label="Pair ${index + 1}, ${side ? 'second' : 'first'} note"><option value="" ${row[side] ? '' : 'selected'} disabled>Select note</option>${bells.map(bell => `<option value="${esc(bell)}" ${row[side] === bell ? 'selected' : ''}>${esc(bellLabel(song, bell))}</option>`).join('')}</select>`;
  return `<fieldset class="field combined-notes"><legend>Combined notes</legend><small class="field-help">Choose two bells to share one player sheet</small>
    ${rows.map((row, index) => `<div class="pair-row">${select(row, index, 0)}${select(row, index, 1)}${tool('remove-pair', `Remove pair ${index + 1}`, 'trash-2', `data-pair="${index}"`)}</div>`).join('')}
    <div>${command('add-pair', 'Add pair', 'plus', 'secondary')}</div></fieldset>`;
}

function sidebar() {
  return `<aside class="section-nav" aria-label="Song sections"><div class="band-heading"><h2>Sections</h2><span class="count">${song.sections.length.toString().padStart(2, '0')}</span></div>
    <ol>${song.sections.map((section, index) => `<li class="section-nav-row ${selected === section.id ? 'active-row' : ''}"><button type="button" data-action="select-section" data-id="${section.id}" class="section-link ${selected === section.id ? 'active' : ''}" aria-label="Open ${esc(sectionLabel(section))}" aria-current="${selected === section.id ? 'true' : 'false'}"><span class="section-index">${String(index + 1).padStart(2, '0')}</span><span>${esc(sectionLabel(section))}</span></button><div class="section-nav-actions" role="group" aria-label="Actions for ${esc(sectionLabel(section))}">
      ${tool('move-up', `Move ${sectionLabel(section)} up`, 'chevron-up', `data-section="${section.id}" ${index === 0 ? 'disabled' : ''}`)}${tool('move-down', `Move ${sectionLabel(section)} down`, 'chevron-down', `data-section="${section.id}" ${index === song.sections.length - 1 ? 'disabled' : ''}`)}${tool('delete-section', `Delete ${sectionLabel(section)}`, 'trash-2', `data-section="${section.id}"`)}</div></li>`).join('')}</ol>
    <div class="add-sections"><h3>Add section</h3>${['Verse', 'Chorus', 'Bridge', 'Other'].map(type => command('add-section', type, 'plus', 'add-section', `data-type="${type.toLowerCase()}" ${metadataReady() ? '' : 'disabled'}`)).join('')}</div>
    <div class="privacy-note">${icon('shield-check')}<p>Processed on this device.<br>No song uploads.</p></div></aside>`;
}

function paletteEvent(): Event | undefined {
  if (!palette || !selectedSection()) return;
  try { return eventsFor(song, selectedSection()!).find(event => event.slot.id === palette!.slotId && event.binding.id === palette!.bindingId); }
  catch { return; }
}
function paletteMarkup() {
  const event = paletteEvent();
  if (!palette || !event) return '';
  const option = (value: string, label: string, selectedValue = false, extra = '') => `<button type="button" data-action="palette-value" data-value="${esc(value)}" aria-pressed="${selectedValue}" ${extra}>${label}</button>`;
  let contents = '';
  if (palette.field === 'duration') contents = `<div class="palette-options" role="toolbar" aria-label="Note durations">${DURATIONS.map(duration => option(String(duration.whole * song.time[1]), `<span class="music-symbol" aria-hidden="true">${duration.label}</span><small>${duration.name}</small>`, Math.abs(duration.whole * song.time[1] - event.beats) < 1e-9, `title="${duration.name}" aria-label="${duration.name}"`)).join('')}</div>
    <label class="exact-duration">Exact beats <input type="number" min="0.000001" step="any" value="${event.beats}" data-exact-duration aria-label="Exact duration in beats"></label>`;
  if (palette.field === 'melody') contents = `<div class="palette-options" role="toolbar" aria-label="Melody pitches">${playableBells(song).map(bell => option(bell, `<i class="bell-dot" style="background:${COLORS[pc(bell)]}"></i><strong>${esc(bellLabel(song, bell))}</strong>`, event.melody === bell)).join('')}</div>`;
  if (palette.field === 'chord') {
    const match = /^([A-G][#b]?)(.*)$/.exec(event.chord);
    const root = match?.[1] || 'C', quality = match?.[2] || '';
    const roots = song.key.includes('b') || song.key.startsWith('F ') ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    contents = `<div class="palette-options compact" role="toolbar" aria-label="Chord roots">${roots.map(pitch => option(pitch + quality, esc(pitch), root === pitch, 'data-stay="true"')).join('')}</div>
      <div class="palette-options compact" role="toolbar" aria-label="Chord qualities">${[['', 'Major'], ['m', 'Minor'], ['7', '7'], ['m7', 'm7'], ['maj7', 'maj7'], ['dim', 'dim'], ['sus2', 'sus2'], ['sus4', 'sus4']].map(([suffix, label]) => option(root + suffix, label, quality === suffix)).join('')}${Object.keys(song.chords).filter(name => !/^([A-G][#b]?)(maj7|m7|m|7)?$/.test(name)).map(name => option(name, esc(name), name === event.chord)).join('')}</div>`;
  }
  if (palette.field === 'ring') contents = `<div class="palette-options compact" role="toolbar" aria-label="Ringing override">${[['auto', 'Auto'], ['chord', 'Full chord'], ...(song.ringMelody ? [['melody', 'Melody only']] : []), ['hold', 'Hold'], ['rest', 'Rest']].map(([value, name]) => option(value, name, event.slot.policy === value, 'data-stay="true"')).join('')}</div>
    <div class="ring-extras">${song.ringMelody ? `<label>Melody <select data-slot-melody><option value="inherit" ${event.slot.ringMelody === null ? 'selected' : ''}>Song setting</option><option value="yes" ${event.slot.ringMelody === true ? 'selected' : ''}>Ring</option><option value="no" ${event.slot.ringMelody === false ? 'selected' : ''}>Do not ring</option></select></label>` : ''}
    <label><input type="checkbox" data-slot-breath ${event.slot.breath_after ? 'checked' : ''}> Breath after</label><fieldset><legend>Omit bells</legend>${playableBells(song).map(bell => `<label class="omit-bell"><input type="checkbox" data-exclude="${esc(bell)}" ${event.slot.exclude_notes.some(note => song.ringMelody ? bellPitch(note) === bellPitch(bell) : pc(note) === pc(bell)) ? 'checked' : ''}>${esc(bellLabel(song, bell))}</label>`).join('')}</fieldset></div><p class="scope-note">Shared by every ${esc(selectedSection()!.type)}.</p>`;
  if (palette.field === 'lyric') {
    const tokens = selectedSection()!.lines[event.line]?.tokens || [];
    const canRemoveExtra = selectedSection()!.bindings[event.slot.id].length > 1 &&
      (Boolean(event.binding.tokenId) || selectedSection()!.bindings[event.slot.id].indexOf(event.binding) > 0);
    contents = `<div class="palette-options compact" role="toolbar" aria-label="Lyric mapping">${tokens.map(token => option(`token:${token.id}`, esc(token.text), token.id === event.binding.tokenId, 'data-stay="true"')).join('')}
      ${option('kind:continue', 'Continue syllable', event.binding.kind === 'continue', 'data-stay="true"')}${option('kind:unused', 'Not used in this verse', event.binding.kind === 'unused', 'data-stay="true"')}${option('kind:rest', 'Rest', event.binding.kind === 'rest', 'data-stay="true"')}</div>
      <div class="token-tools">${command('edit-token', 'Edit word', 'pencil', '', event.binding.tokenId ? '' : 'disabled')}${command('split-token', 'Split syllable', 'scissors', '', event.binding.tokenId ? '' : 'disabled')}${command('join-token', 'Join next', 'link-2', '', event.binding.tokenId ? '' : 'disabled')}${command('subdivide', 'Split note', 'scissors')}${command('remove-child', event.binding.tokenId ? 'Reset extra note' : 'Remove extra note', event.binding.tokenId ? 'rotate-ccw' : 'trash-2', '', canRemoveExtra ? '' : 'disabled')}</div>`;
  }
  const labels = { duration: 'Note length', melody: 'Melody', chord: 'Chord', ring: 'Ringing', lyric: 'Lyric & alignment' };
  const section = selectedSection()!;
  const atNoteStart = section.bindings[event.slot.id]?.[0]?.id === event.binding.id;
  const canBreak = atNoteStart && selectedPattern()!.lines[event.line].slots[0]?.id !== event.slot.id;
  const hasLyrics = noteHasLyrics(event.slot.id, section.type);
  return `<div class="palette" aria-label="${labels[palette.field]} palette"><div class="palette-heading"><strong>${labels[palette.field]} <span> / ${esc(event.lyric || 'Untexted note')}</span></strong>${tool('close-palette', 'Close palette', 'x')}</div>
    <div class="palette-layout"><div class="palette-content">${contents}</div><div class="palette-actions" role="group" aria-label="Note actions">
      ${command('add-note', 'Add note here', 'plus', 'secondary')}
      <span title="${!atNoteStart ? 'Select the first subdivision of this shared note to break the line.' : canBreak ? 'Move this note and all notes to its right to the next line in every linked verse.' : 'This note already starts a line.'}">${command('break-line', 'Break line here', 'corner-down-left', 'secondary', canBreak ? '' : 'disabled')}</span>
      ${command('remove-slot', hasLyrics ? 'Reset note' : 'Remove note', hasLyrics ? 'rotate-ccw' : 'trash-2', 'danger-quiet')}
    </div></div></div>`;
}

function musicEditor(section: Section) {
  let events: Event[];
  try { events = eventsFor(song, section); }
  catch (error) { return `<p class="inline-error">${esc((error as Error).message)}</p>${command('lyrics', 'Edit lyrics', 'pencil')}`; }
  let strikeError = '';
  try { events = perform(song, section); }
  catch (error) { strikeError = (error as Error).message; }
  const editable = section.stage !== 'done';
  const pattern = selectedPattern()!;
  const selectedNote = paletteEvent();
  const lineMarkup = pattern.lines.map((line, lineIndex) => `<div class="music-line"><div class="line-heading"><span>Line ${lineIndex + 1}</span><span>${events.filter(event => event.line === lineIndex).reduce((sum, event) => sum + event.beats, 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} beats</span></div>
    ${editable && selectedNote?.line === lineIndex ? paletteMarkup() : ''}
    <div class="word-track">${line.slots.map(slot => `<div class="slot-group">${events.filter(event => event.slot.id === slot.id).map(event => {
      const active = palette?.bindingId === event.binding.id;
      const cellButton = (field: string, label: string, value: string, cls = '') => editable ?
        `<button type="button" class="cell-value ${cls} ${active && palette?.field === field ? 'selected-value' : ''}" data-action="open-palette" data-slot="${slot.id}" data-binding="${event.binding.id}" data-field="${field}" aria-label="${label} for ${esc(event.lyric || 'untexted note')}">${value}</button>` : `<span class="read-value ${cls}">${value}</span>`;
      return `<div class="word-cell ${event.boundaries.length ? 'bar-end' : ''} ${active ? 'active-cell' : ''} ${event.binding.kind === 'unused' ? 'unused-cell' : ''}">
        ${cellButton('lyric', 'Lyric mapping', esc(event.lyric || (event.binding.kind === 'continue' ? '\u203f' : event.binding.kind === 'rest' ? 'Rest' : '\u2014')), 'lyric-value')}
        ${cellButton('duration', 'Duration', esc(durationLabel(event.beats, song.time[1], song.time[0], event.start)), 'duration-value')}
        ${cellButton('melody', 'Melody', `<i class="bell-dot" style="background:${COLORS[pc(event.binding.melody || slot.melody)]}"></i>${esc(bellLabel(song, event.binding.melody || slot.melody))}`, 'melody-value')}
        ${cellButton('chord', 'Chord', esc(event.chord), 'chord-value')}
        ${editable ? cellButton('ring', 'Ringing', `${icon('bell-ring')}<small>${esc(slot.policy === 'auto' ? 'Auto' : slot.policy)}</small>`, 'ring-value') : `<span class="ring-read">${esc(slot.policy === 'auto' ? '' : slot.policy)}</span>`}
        <div class="calculated-bells" role="group" aria-label="Calculated strikes for ${esc(event.lyric || 'untexted note')}" title="${esc(strikeError || 'Calculated bell strikes and held bells')}">${strikeError ? '<em>Unavailable</em>' : event.sounding.length ? playableBells(song).filter(bell => event.sounding.includes(bell)).map(bell => `<span class="${event.strike.includes(bell) ? 'calculated-strike' : 'calculated-held'}" title="${esc(bellLabel(song, bell))}: ${event.strike.includes(bell) ? 'strike' : 'hold'}" style="--bell:${COLORS[pc(bell)]};--bell-ink:var(--${pc(bell) < 2 ? 'score-bell-dark-ink' : 'score-bell-ink'})">${esc(bellLabel(song, bell))}</span>`).join('') : '<em>No strikes</em>'}</div>
        ${event.boundaries.filter(offset => offset < event.beats).map(offset => `<span class="editor-crossing" style="left:${offset / event.beats * 100}%" title="Measure boundary; tied continuation"></span>`).join('')}
      </div>`;
    }).join('')}</div>`).join('')}</div></div>`).join('');
  const issues = problems(song, false).filter(problem => problem.toLowerCase().startsWith(sectionLabel(section).toLowerCase()) || problem.startsWith(`${section.type} `));
  const used = new Set(Object.values(section.bindings).flat().map(binding => binding.tokenId));
  const unassigned = section.lines.flatMap(line => line.tokens).filter(token => !used.has(token.id));
  return `${editable ? `<div class="editing-toolbar"><div class="segmented" role="group" aria-label="Music edit scope"><button type="button" data-action="scope-shared" aria-pressed="${!verseOnly}">Shared music</button><button type="button" data-action="scope-verse" aria-pressed="${verseOnly}">This verse only</button></div><div class="toolbar-actions">${tool('reset-exceptions', 'Reset this verse to shared music', 'rotate-ccw')}${command('lyrics', 'Lyrics', 'pencil')}${command('done', 'Done', 'check', 'primary')}</div></div>` : ''}
    ${issues.length ? `<div class="inline-error">${issues.map(esc).join('<br>')}</div>` : ''}
    ${unassigned.length ? `<div class="inline-error">Unassigned words: ${unassigned.map(token => esc(token.text)).join(', ')}</div>` : ''}
    ${lineMarkup}`;
}

function editor() {
  const section = selectedSection();
  if (!section) return `<section class="editor-empty"><div class="empty-score" aria-hidden="true"><div></div><div></div><div></div>${icon('music-2')}</div><h2>A new arrangement</h2><p>${song.title ? esc(song.title) : 'Untitled ringalong'}</p><div class="empty-actions">${command('add-section', 'Add verse', 'plus', 'primary', `data-type="verse" ${metadataReady() ? '' : 'disabled'}`)}</div></section>`;
  return `<section class="editor" aria-labelledby="editor-title"><header class="editor-heading"><div><span class="eyebrow">${section.stage === 'done' ? 'SECTION COMPLETE' : 'SECTION EDITOR'}</span><div class="section-title-row"><h2 id="editor-title">${esc(sectionLabel(section))}</h2>${tool('rename-section', 'Rename section', 'pencil')}</div></div><div class="section-controls">
    ${section.stage === 'done' ? command('edit', 'Edit', 'pencil', 'secondary') : ''}</div></header>
    ${section.stage === 'lyrics' || section.stage === 'suggestions' ? lyricEditor(section) : musicEditor(section)}</section>`;
}

function suggestedLyrics(raw: string) {
  return raw.split('\n').map(line => line.split(/(\s+)/).map(token => {
    if (!token.trim() || token.includes('-')) return token;
    return hyphenateSync(token, { hyphenChar: '- ' });
  }).join('')).join('\n');
}
function lyricEditor(section: Section) {
  const suggestions = section.stage === 'suggestions';
  const text = suggestions ? section.suggestion ?? suggestedLyrics(section.raw) : section.raw;
  return `<div class="lyric-editor"><label for="lyrics-input">${suggestions ? 'Review syllable breaks' : 'Lyrics'}</label>
    <p class="lyric-instructions">Type the lyrics. Separate each line with a carriage return. Words are separated by spaces. If you split a word with a dash or use punctuation, do not put a space between the word and its punctuation.</p>
    <textarea id="lyrics-input" name="lyrics" rows="8" placeholder="Enter lyrics…" spellcheck="true">${esc(text)}</textarea>
    <div class="lyric-footer">${suggestions ? `<span class="quiet">Suggestions may need correction for singing.</span><div>${command('use-original', 'Keep original', 'rotate-ccw')}${command('confirm-lyrics', 'Use these words', 'check', 'primary')}</div>` : `<label class="check-field"><input id="suggest-syllables" type="checkbox" checked> Suggest syllable breaks</label>${command('next', 'Next', 'arrow-right', 'primary')}`}</div></div>`;
}

function render() {
  ensureSectionNames(song);
  normalizeAttribution(song);
  const focused = document.activeElement as HTMLElement | null;
  const focusedAction = focused?.dataset.action;
  const focusedValue = focused?.dataset.value;
  const scrolls = [...document.querySelectorAll<HTMLElement>('.word-track')].map(element => element.scrollLeft);
  const advancedOpen = document.querySelector<HTMLDetailsElement>('.advanced')?.open;
  app.innerHTML = `<header class="app-header"><a class="brand" href="./" aria-label="Ringalong Studio"><span class="brand-mark">${icon('bell-ring')}</span><span>Ringalong<span class="brand-studio">STUDIO</span></span></a><nav aria-label="File actions">${themeButton()}${tool('new', 'New ringalong', 'file-plus-2')}${tool('undo', 'Undo', 'undo-2', past.length ? '' : 'disabled')}${tool('redo', 'Redo', 'redo-2', future.length ? '' : 'disabled')}<span class="toolbar-divider"></span>${command('import', 'Import', 'upload', 'secondary')}${command('export', 'Save / Export', 'download', 'primary')}</nav></header>
    <main>
    <div id="notice" class="notice ${messageIsError ? 'error' : ''}" role="status" aria-live="polite" ${message ? '' : 'hidden'}>${esc(message)}</div>
    ${metadata()}<div class="workspace">${sidebar()}<div class="editor-column">${editor()}</div></div>
    <section class="preview-band" aria-labelledby="preview-title"><div class="band-heading"><div><span class="eyebrow">THE BELL PARTS</span><div class="preview-title-row"><h2 id="preview-title">Score preview</h2>${command('preview', 'Preview', 'eye', 'secondary')}</div></div></div><div id="preview">${previewed ? renderPreview() : `<div class="preview-empty">${icon('music-2')}<span>No preview generated</span></div>`}</div></section>
    </main><footer class="app-footer"><div><label class="check-field"><input id="recovery-enabled" type="checkbox" ${recovery.enabled ? 'checked' : ''}> Local recovery</label><span id="recovery-status"></span>${command('clear-draft', 'Clear draft', 'trash-2', 'text-button')}</div><p>Recovery keeps lyrics on this device. Exported files contain your lyrics and arrangement.</p></footer>
    <input id="import-file" type="file" accept=".json,.html,.htm,application/json,text/html" hidden>`;
  createIcons({ icons });
  if (advancedOpen) document.querySelector<HTMLDetailsElement>('.advanced')!.open = true;
  document.querySelectorAll<HTMLElement>('.word-track').forEach((element, index) => { element.scrollLeft = scrolls[index] || 0; });
  if (previewed) document.querySelectorAll<HTMLElement>('.score-root').forEach(bindScore);
  if (focusedAction === 'palette-value' && focusedValue !== undefined) {
    document.querySelector<HTMLElement>(`[data-action="palette-value"][data-value="${CSS.escape(focusedValue)}"]`)?.focus({ preventScroll: true });
  }
  document.querySelector<HTMLElement>('.active-cell')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateRecoveryStatus();
}

function renderPreview() {
  try {
    const errors = problems(song, false);
    if (errors.length) return `<p class="inline-error">${errors.map(esc).join('<br>')}</p>`;
    if (!song.sections.some(section => ['music', 'done'].includes(section.stage))) return '<p class="quiet">No musical sections yet.</p>';
    return `${song.sections.some(section => ['lyrics', 'suggestions'].includes(section.stage)) ? '<p class="preview-warning">Unfinished lyric sections are not included.</p>' : ''}${scoreMarkup(song)}`;
  } catch (error) { return `<p class="inline-error">${esc((error as Error).message)}</p>`; }
}

function assignValue(value: string, stay = false) {
  const event = paletteEvent(); if (!palette || !event) return;
  const field = palette.field;
  edit(() => {
    if (field === 'duration') {
      const beats = Number(value); if (!Number.isFinite(beats) || beats <= 0) throw new Error('Duration must be a positive number.');
      if (verseOnly) event.binding.beats = beats;
      else {
        const ratio = new Fraction(String(beats)).div(String(event.slot.beats));
        event.slot.beats = beats;
        song.sections.filter(section => section.type === selectedSection()!.type).forEach(section =>
          (section.bindings[event.slot.id] || []).forEach(binding => { if (binding.beats !== undefined) binding.beats = new Fraction(String(binding.beats)).mul(ratio).toFraction(); }));
      }
    } else if (field === 'melody' || field === 'chord') {
      if (field === 'chord') chordTones(song, value);
      if (verseOnly) event.binding[field] = value; else event.slot[field] = value;
    } else if (field === 'ring') event.slot.policy = value as Note['policy'];
    else {
      if (value.startsWith('token:')) { event.binding.tokenId = value.slice(6); event.binding.kind = 'word'; }
      else { delete event.binding.tokenId; event.binding.kind = value.slice(5) as Binding['kind']; }
    }
    if (!stay && field !== 'ring' && field !== 'lyric') {
      const events = eventsFor(song, selectedSection()!);
      const index = events.findIndex(item => item.binding.id === event.binding.id);
      const next = events[index + 1];
      if (next) palette = { ...palette!, slotId: next.slot.id, bindingId: next.binding.id };
    }
  });
}

function selectedToken() {
  const event = paletteEvent(); if (!event?.binding.tokenId) return;
  const line = selectedSection()!.lines.find(line => line.tokens.some(token => token.id === event.binding.tokenId));
  const index = line?.tokens.findIndex(token => token.id === event.binding.tokenId) ?? -1;
  return line && index >= 0 ? { event, line, index, token: line.tokens[index] } : undefined;
}
function noteHasLyrics(noteId: string, type: string) {
  return song.sections.some(section => section.type === type &&
    (section.bindings[noteId] || []).some(binding => Boolean(binding.tokenId)));
}
function resetNoteMusic(note: Note, type: string) {
  Object.assign(note, newNote(song), { id: note.id, word: note.word });
  song.sections.filter(section => section.type === type).forEach(section => {
    const bindings = section.bindings[note.id] || [];
    bindings.forEach(binding => {
      delete binding.melody; delete binding.chord;
      if (bindings.length > 1) binding.beats = new Fraction(String(note.beats)).div(bindings.length).toFraction();
      else delete binding.beats;
    });
  });
}
function syncRaw() { const section = selectedSection()!; section.raw = section.lines.map(line => line.tokens.map(token => token.text).join(' ')).join('\n'); }
function confirmation(text: string) { return window.confirm(text); }

function updateLookupButton() {
  const reset = document.querySelector<HTMLButtonElement>('[data-action="reset-hymn"]');
  if (reset) reset.disabled = loadingHymn;
  const button = document.querySelector<HTMLButtonElement>('[data-action="load-hymn"]');
  if (!button) return;
  button.disabled = loadingHymn || !song.hymnNumber.trim();
  button.setAttribute('aria-busy', String(loadingHymn));
  button.setAttribute('aria-label', loadingHymn ? 'Loading hymn' : 'Look up');
  button.innerHTML = `${icon('globe')}<span>${loadingHymn ? 'Loading…' : 'Look up'}</span>`;
  createIcons({ icons });
}

async function lookupHymn() {
  if (loadingHymn) return;
  const requestedNumber = song.hymnNumber;
  const reference = hymnReference(requestedNumber);
  const number = reference.number;
  loadingHymn = true; updateLookupButton();
  try {
    const catalog = await loadHymnCatalog();
    const matches = matchingHymns(catalog, requestedNumber);
    if (!matches.length) {
      notify(`No reviewed public-domain music is available for ${reference.abbreviation} ${number} yet. It may be restricted or not yet mapped. See the catalog refresh instructions in the project README to add coverage. Your arrangement has not been changed.`, true);
      const link = document.createElement('a');
      const hymnalSlug = reference.hymnal === 'TFWS2000' ? 'FWS' : 'UMH';
      link.href = `https://hymnary.org/hymn/${hymnalSlug}/${number}`;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `View ${reference.abbreviation} ${number} reference`;
      const notice = document.querySelector('#notice'); notice?.append(document.createElement('br'), link);
      return;
    }
    const choice = await chooseHymn(matches);
    if (!choice) return;
    const imported = await loadHymn(choice.source, choice.keepBells ? song.bells : undefined);
    if (meaningful() && !confirmation(`Replace the current arrangement with ${choice.source.title}? Export first to keep your work.`)) return;
    checkpoint(); song = imported; selected = song.sections[0]?.id || ''; palette = undefined; verseOnly = false; previewed = true;
    changed();
    const unaligned = song.sections.filter(section => section.stage === 'lyrics').length;
    notify(`Loaded ${choice.source.hymnal === 'TFWS2000' ? 'TFWS' : 'UMH'} ${number}: ${song.title}. Review the imported music and inferred harmony.${unaligned ? ` ${unaligned} additional verse${unaligned === 1 ? '' : 's'} need lyric alignment.` : ''}`);
  } finally { loadingHymn = false; updateLookupButton(); }
}

function setPairNote(index: number, side: number, value: string) {
  const committed = index < song.combined.length;
  const row = committed ? song.combined[index].map(note => resolveBell(song, note) ?? '') : draftPairs[index - song.combined.length];
  row[side] = value;
  const complete = row.every(Boolean);
  const others = song.combined.filter((_, other) => other !== index).map(pair => pair.map(note => resolveBell(song, note)).sort().join(' '));
  const problem = !complete ? '' : row[0] === row[1] ? 'Combined notes: choose two different bells.' :
    others.includes([...row].sort().join(' ')) ? 'Combined notes: that combination is already listed.' : '';
  if (problem) { notify(problem, true); if (committed) render(); return; }
  if (!complete) { if (committed) render(); return; }
  notify('');
  if (committed) edit(() => { song.combined[index] = [row[0], row[1]]; });
  else { draftPairs.splice(index - song.combined.length, 1); edit(() => { song.combined.push([row[0], row[1]]); }); }
}

async function handleAction(button: HTMLElement) {
  const action = button.dataset.action;
  const section = button.dataset.section ? song.sections.find(section => section.id === button.dataset.section) : selectedSection();
  if (action === 'add-pair') { draftPairs.push(['', '']); render(); }
  else if (action === 'remove-pair') {
    const index = Number(button.dataset.pair);
    if (index < song.combined.length) edit(() => { song.combined.splice(index, 1); });
    else { draftPairs.splice(index - song.combined.length, 1); render(); }
  }
  else if (action === 'load-hymn') await lookupHymn();
  else if (action === 'reset-hymn') {
    if (loadingHymn) return;
    const baseline = restoreHymnDefaults(song);
    if (!baseline && !song.extensions.webSource) throw new Error('No original downloaded hymn is recorded for this arrangement.');
    if (!confirmation('Reset this entire hymn to its original imported arrangement? This replaces current lyrics, notes, sections, bells and song settings. Undo can restore your edits.')) return;
    loadingHymn = true; updateLookupButton();
    try {
      const restored = baseline || await loadHymn(song.extensions.webSource as HymnSource);
      const errors = problems(restored, false);
      if (errors.length) throw new Error(errors.join('\n'));
      checkpoint(); song = restored; selected = song.sections[0]?.id || ''; palette = undefined; verseOnly = false; previewed = true;
      changed(); notify('Original hymn restored. Undo will restore your previous edits.');
    } finally { loadingHymn = false; updateLookupButton(); }
  }
  else if (action === 'toggle-theme') {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
    button.outerHTML = themeButton();
    createIcons({ icons });
    document.querySelector<HTMLElement>('[data-action="toggle-theme"]')?.focus({ preventScroll: true });
  } else if (action === 'new') {
    if (meaningful() && !confirmation('Start a new ringalong? Export first to keep the current arrangement.')) return;
    checkpoint(); song = newSong(); selected = ''; palette = undefined; previewed = false; verseOnly = false; changed(); notify('New arrangement.');
  } else if (action === 'undo' || action === 'redo') {
    const from = action === 'undo' ? past : future, to = action === 'undo' ? future : past;
    const previous = from.pop(); if (!previous) return; to.push(JSON.stringify(song)); song = JSON.parse(previous);
    if (!selectedSection()) selected = song.sections[0]?.id || ''; palette = undefined; changed();
  } else if (action === 'import') document.querySelector<HTMLInputElement>('#import-file')!.click();
  else if (action === 'export') {
    const saved = await downloadSong(song);
    if (saved) { savedSource = JSON.stringify(song); notify('HTML exported. Editing can continue.'); }
    else notify('Export cancelled. Current editing is unchanged.');
  } else if (action === 'preview') { previewed = true; render(); document.querySelector('#preview-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  else if (action === 'clear-draft') { recovery.clear(); recoveryDirty = false; updateRecoveryStatus(); notify('Local draft cleared. Current editing is unchanged.'); }
  else if (action === 'add-section') {
    if (!metadataReady()) throw new Error(problems({ ...song, sections: [] }, false).join('\n'));
    let type = button.dataset.type || 'verse';
    if (type === 'other') { type = window.prompt('Section type', 'Outro')?.trim().toLowerCase() || ''; if (!type) return; }
    edit(() => { const added = newSection(song, type);
      song.sections.push(added); selected = added.id; palette = undefined; verseOnly = false; });
    document.querySelector<HTMLTextAreaElement>('#lyrics-input')?.focus();
  } else if (action === 'select-section') { selected = button.dataset.id!; palette = undefined; verseOnly = false; render(); }
  else if (section) {
    if (action === 'next' || action === 'confirm-lyrics' || action === 'use-original') {
      const text = action === 'use-original' ? section.raw : document.querySelector<HTMLTextAreaElement>('#lyrics-input')!.value;
      if (!text.trim()) throw new Error('Enter lyrics before continuing.');
      edit(() => {
        if (action === 'next' && document.querySelector<HTMLInputElement>('#suggest-syllables')?.checked) {
          section.raw = text; section.suggestion = suggestedLyrics(text); section.stage = 'suggestions';
        } else { alignSection(song, section, text); palette = undefined; }
      });
    } else if (action === 'edit' || action === 'lyrics') {
      if (action === 'lyrics' && !confirmation('Editing lyrics remaps this verse to the shared music and resets its verse-only exceptions. Continue?')) return;
      edit(() => { section.stage = action === 'lyrics' ? 'lyrics' : 'music'; palette = undefined; });
    } else if (action === 'done') {
      const errors = problems(song, false);
      if (errors.length) throw new Error(errors.join('\n'));
      edit(() => { section.stage = 'done'; palette = undefined; });
    } else if (action === 'scope-shared' || action === 'scope-verse') { verseOnly = action === 'scope-verse'; render(); }
    else if (action === 'close-palette') { palette = undefined; render(); }
    else if (action === 'open-palette') {
      palette = { slotId: button.dataset.slot!, bindingId: button.dataset.binding!, field: button.dataset.field as NonNullable<typeof palette>['field'] }; render();
    } else if (action === 'palette-value') assignValue(button.dataset.value!, button.dataset.stay === 'true');
    else if (action === 'rename-section') {
      const name = window.prompt('Section name', sectionLabel(section))?.trim();
      if (!name) return;
      if (name.length > 200) throw new Error('Use a section name of 200 characters or fewer.');
      edit(() => { section.name = name;
        const match = /^(.*)\s+([1-9]\d*)$/.exec(name);
        if (match?.[1].toLowerCase() === section.type.toLowerCase() && Number.isSafeInteger(Number(match[2]))) section.number = Number(match[2]);
      });
    } else if (action === 'delete-section') {
      if (!confirmation(`Delete ${sectionLabel(section)}?`)) return;
      edit(() => { const index = song.sections.indexOf(section); song.sections.splice(index, 1);
        if (selected === section.id) { selected = song.sections[Math.max(0, index - 1)]?.id || ''; palette = undefined; }
      });
    } else if (action === 'move-up' || action === 'move-down') {
      edit(() => { const index = song.sections.indexOf(section), target = index + (action === 'move-up' ? -1 : 1);
        if (target >= 0 && target < song.sections.length) [song.sections[index], song.sections[target]] = [song.sections[target], song.sections[index]]; });
    } else if (action === 'reset-exceptions') {
      if (!confirmation('Reset this verse’s durations, melody and chords to shared defaults? Lyric mapping is kept.')) return;
      edit(() => { selectedPattern()!.lines.forEach(line => line.slots.forEach(slot => {
        const bindings = section.bindings[slot.id] || [];
        bindings.forEach(binding => { delete binding.melody; delete binding.chord;
          if (bindings.length > 1) binding.beats = new Fraction(String(slot.beats)).div(bindings.length).toFraction(); else delete binding.beats; });
      })); });
    } else if (action === 'break-line') {
      const event = paletteEvent(); if (!event) return;
      if (section.bindings[event.slot.id]?.[0]?.id !== event.binding.id) throw new Error('Select the first subdivision of the shared note to break the line.');
      if (selectedPattern()!.lines[event.line].slots[0]?.id === event.slot.id) return;
      edit(() => { breakLineHere(song, section.type, event.slot.id); });
    } else if (action === 'add-note') {
      edit(() => {
        const event = paletteEvent(); const pattern = selectedPattern()!;
        const line = pattern.lines[event?.line ?? pattern.lines.length - 1];
        const note = newNote(song);
        note.word = false;
        if (event) Object.assign(note, { melody: event.slot.melody, chord: event.slot.chord, beats: event.slot.beats });
        line.slots.splice(event ? line.slots.indexOf(event.slot) + 1 : line.slots.length, 0, note);
        song.sections.filter(item => item.type === section.type).forEach(item => { item.bindings[note.id] = [{ id: id(), kind: 'continue' }]; });
      });
    } else if (action === 'remove-slot') {
      const event = paletteEvent(); if (!event) return;
      const keepLyrics = noteHasLyrics(event.slot.id, section.type);
      if (!confirmation(keepLyrics ? 'Reset this note’s shared music to defaults? All words and verse mappings will be kept.' : 'Remove this untexted note and add its duration to the preceding note in every linked verse?')) return;
      edit(() => {
        if (keepLyrics) resetNoteMusic(event.slot, section.type);
        else removeUntextedNote(song, section.type, event.slot.id);
        palette = undefined;
      });
    } else if (action === 'subdivide') {
      const event = paletteEvent(); if (!event) return;
      edit(() => {
        const bindings = section.bindings[event.slot.id], index = bindings.indexOf(event.binding);
        const beats = new Fraction(String(event.binding.beats ?? event.slot.beats)).div(2).toFraction();
        event.binding.beats = beats;
        bindings.splice(index + 1, 0, { id: id(), kind: 'continue', beats, melody: event.binding.melody, chord: event.binding.chord });
      });
    } else if (action === 'remove-child') {
      const event = paletteEvent(); if (!event) return;
      if (event.binding.tokenId) {
        if (!confirmation('Reset this note’s shared music to defaults? All words and verse mappings will be kept.')) return;
        edit(() => { resetNoteMusic(event.slot, section.type); palette = undefined; });
        return;
      }
      edit(() => { const bindings = section.bindings[event.slot.id]; if (bindings.length < 2) return;
        const index = bindings.indexOf(event.binding);
        if (index < 1) throw new Error('The first subdivision cannot transfer its duration backward within this shared note.');
        const previous = bindings[index - 1];
        previous.beats = new Fraction(String(previous.beats ?? event.slot.beats)).add(String(event.binding.beats ?? event.slot.beats)).toFraction();
        bindings.splice(index, 1); palette = { ...palette!, bindingId: previous.id }; });
    } else if (action === 'edit-token') {
      const token = selectedToken(); if (!token) return;
      const text = window.prompt('Word or syllable', token.token.text)?.trim(); if (!text) return;
      if (/\s/.test(text)) throw new Error('Use Split syllable to create multiple lyric tokens.');
      edit(() => { token.token.text = text; syncRaw(); });
    } else if (action === 'split-token') {
      const token = selectedToken(); if (!token) return;
      const text = window.prompt('Separate syllables with spaces', token.token.text)?.trim(); if (!text) return;
      const parts = text.split(/\s+/); if (parts.length < 2) throw new Error('Enter at least two space-separated syllables.');
      edit(() => {
        const tokens = parts.map((text, index) => ({ id: index === 0 ? token.token.id : id(), text }));
        token.line.tokens.splice(token.index, 1, ...tokens);
        const bindings = section.bindings[token.event.slot.id], index = bindings.indexOf(token.event.binding);
        bindings.splice(index, 1, ...tokens.map(item => ({ ...token.event.binding, id: id(), tokenId: item.id, kind: 'word' as const, beats: new Fraction(String(token.event.binding.beats ?? token.event.slot.beats)).div(parts.length).toFraction() })));
        palette = undefined; syncRaw();
      });
    } else if (action === 'join-token') {
      const token = selectedToken(); if (!token) return;
      const next = token.line.tokens[token.index + 1]; if (!next) throw new Error('There is no next token on this line.');
      edit(() => { token.token.text = token.token.text.replace(/-$/, '') + next.text; token.line.tokens.splice(token.index + 1, 1);
        Object.values(section.bindings).flat().forEach(binding => { if (binding.tokenId === next.id) { delete binding.tokenId; binding.kind = 'continue'; } }); syncRaw(); });
    }
  }
}

app.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (button && !button.hasAttribute('disabled')) void handleAction(button).catch(error => notify(error.message, true));
});

app.addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  try {
    if (input.id === 'import-file') {
      const file = input.files?.[0]; if (!file) return;
      if (file.size > MAX_FILE_SIZE) throw new Error('File exceeds the 8 MB size limit.');
      const imported = readDocument(await file.text());
      if (meaningful() && !confirmation('Replace the current arrangement with the imported file? Export first to keep your work.')) return;
      checkpoint(); song = imported; selected = song.sections[0]?.id || ''; palette = undefined; previewed = true; verseOnly = false;
      savedSource = JSON.stringify(song); changed(); notify(`Imported ${file.name}.`); return;
    }
    if (input.id === 'recovery-enabled') { recovery.setEnabled(input.checked); if (input.checked) { recovery.save(song); recoveryDirty = false; } updateRecoveryStatus(); return; }
    if (input.name === 'lyrics' || input.id === 'suggest-syllables') return;
    if (input.hasAttribute('data-exact-duration')) { assignValue(input.value, true); return; }
    const musicalEvent = paletteEvent();
    if (input.hasAttribute('data-slot-melody') && musicalEvent) { edit(() => { musicalEvent.slot.ringMelody = input.value === 'inherit' ? null : input.value === 'yes'; }); return; }
    if (input.hasAttribute('data-slot-breath') && musicalEvent) { edit(() => { musicalEvent.slot.breath_after = input.checked; }); return; }
    if (input.dataset.exclude && musicalEvent) { edit(() => {
      const bell = input.dataset.exclude!;
      musicalEvent.slot.exclude_notes = musicalEvent.slot.exclude_notes.filter(note => song.ringMelody ? bellPitch(note) !== bellPitch(bell) : pc(note) !== pc(bell));
      if (input.checked) musicalEvent.slot.exclude_notes.push(bell);
    }); return; }
    if (input.dataset.pair !== undefined) { setPairNote(Number(input.dataset.pair), Number(input.dataset.side), input.value); return; }
    if (input.dataset.beat) { edit(() => { const beat = Number(input.dataset.beat); song.strong = song.strong.filter(value => value !== beat); if (input.checked) song.strong.push(beat); song.strong.sort((a, b) => a - b); }); return; }
    const name = input.name;
    if (!name) return;
    if (['title', 'hymnNumber', 'credit'].includes(name)) { textEditName = ''; return; }
    let parsedChords: Song['chords'] | undefined;
    let bells: string[] | undefined;
    if (name === 'chords') {
      parsedChords = chordDefinitionsSchema.parse(JSON.parse(input.value));
    }
    if (name === 'bells') {
      bells = input.value.split(/[\s,]+/).filter(Boolean).sort((a, b) => bellPitch(a) - bellPitch(b));
      if (!bells.length || new Set(bells.map(bellPitch)).size !== bells.length) throw new Error('Enter unique bell pitches.');
      if (song.ringMelody && bells.some(bell => !/\d$/.test(bell))) throw new Error('Melody mode requires an octave for each bell, for example C4 or C5.');
    }
    edit(() => {
      if (name === 'timeTop') { song.time[0] = Number(input.value); song.strong = song.strong.filter(beat => beat <= song.time[0]); }
      else if (name === 'timeBottom') song.time[1] = Number(input.value);
      else if (name === 'pickup') song.pickup = Number(input.value);
      else if (name === 'ringMelody') song.ringMelody = input.value === 'melody';
      else if (name === 'chords') song.chords = parsedChords!;
      else if (name === 'bells') { song.bells = bells!; song.recommended = [...bells!]; }
      else if (['title', 'hymnNumber', 'key', 'credit'].includes(name)) (song as unknown as Record<string, unknown>)[name] = input.value;
    });
  } catch (error) { notify((error as Error).message, true); }
});

app.addEventListener('input', event => {
  const input = event.target as HTMLTextAreaElement;
  if (input.name === 'lyrics') {
    const section = selectedSection(); if (!section) return;
    if (textEditName !== 'lyrics') { checkpoint(); textEditName = 'lyrics'; }
    if (section.stage === 'lyrics') section.raw = input.value;
    else if (section.stage === 'suggestions') section.suggestion = input.value;
    recoveryDirty = true; recovery.schedule(song, () => { recoveryDirty = false; updateRecoveryStatus(); });
  } else if (['title', 'hymnNumber', 'credit'].includes(input.name)) {
    if (textEditName !== input.name) { checkpoint(); textEditName = input.name; }
    (song as unknown as Record<string, unknown>)[input.name] = input.value;
    changed(false);
    if (input.name === 'hymnNumber') updateLookupButton();
    document.querySelectorAll<HTMLButtonElement>('[data-action="add-section"]').forEach(button => { button.disabled = !metadataReady(); });
  }
});
app.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  if (event.key === 'Enter' && (target as HTMLInputElement).name === 'hymnNumber') {
    event.preventDefault(); void lookupHymn().catch(error => notify(error.message, true)); return;
  }
  const toolbar = target.closest<HTMLElement>('[role="toolbar"]');
  if (toolbar && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    let index = buttons.indexOf(target as HTMLButtonElement);
    index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[index]?.focus();
  }
  if (event.key === 'Escape' && palette) { palette = undefined; render(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); const button = document.querySelector<HTMLElement>('[data-action="export"]'); if (button) void handleAction(button).catch(error => notify(error.message, true));
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && recoveryDirty) { recovery.save(song); recoveryDirty = false; } });
window.addEventListener('beforeunload', event => {
  if (recoveryDirty) recovery.save(song);
  if (meaningful() && JSON.stringify(song) !== savedSource) event.preventDefault();
});
render();