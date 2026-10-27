import Fraction from 'fraction.js';
import { sectionTitle, type Song, type Section } from './document';
import { COLORS, bellLabel, combinedPairs, pc, playableBells, perform, type Event } from './music';
import scoreStyles from './score.css?inline';
import themeStyles from './theme.css?inline';
import musicFont from '@fontsource/noto-music/files/noto-music-music-400-normal.woff2?inline';
import musicLicense from '../../node_modules/@fontsource/noto-music/LICENSE?raw';

export const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);
export const scoreCSS = `@font-face{font-family:ScoreMusic;src:url('${musicFont}') format('woff2');font-display:swap}\n${themeStyles}\n${scoreStyles}`;
export const scoreLicense = musicLicense;

interface Performance { section: Section; events: Event[] }
const eventEnd = (event: Event) => event.start.add(String(event.binding.beats ?? event.slot.beats));

function bellMarkers(song: Song, event: Event | undefined, at: Fraction): string {
  if (!event?.sounding.length) return '<span class="score-rest">\u2014</span>';
  const onset = event.start.compare(at) === 0;
  return `<span class="score-bells">${playableBells(song).filter(bell => event.sounding.includes(bell)).map(bell => {
    const ringing = onset && event.strike.includes(bell);
    return `<span class="score-bell ${ringing ? 'score-bell-strike' : 'score-bell-sustain'}" style="--bell:${COLORS[pc(bell)]};--bell-ink:var(--${pc(bell) < 2 ? 'score-bell-dark-ink' : 'score-bell-ink'})" aria-label="${escape(bellLabel(song, bell))}: ${ringing ? 'strike' : 'sustain'}" title="${escape(bellLabel(song, bell))}: ${ringing ? 'strike' : 'sustain'}">${escape(bellLabel(song, bell))}</span>`;
  }).join('')}</span>`;
}

function combinedVariants(values: { value: string; number: number }[]): string {
  const groups = new Map<string, number[]>();
  for (const { value, number } of values) groups.set(value, [...(groups.get(value) || []), number]);
  if (groups.size === 1) return values[0]?.value || '';
  return [...groups].map(([value, numbers]) => `<span class="score-variant"><small class="score-variant-number">${numbers.join(', ')}:</small>${value}</span>`).join('');
}

function conductorLine(song: Song, group: Performance[], line: number): string {
  // A note (a slot, or one subdivision of it) that carries no word in any verse is left out of the conductor.
  const keyed = group.map(performance => {
    const seen = new Map<string, number>();
    return performance.events.filter(event => event.line === line).map(event => {
      const child = seen.get(event.slot.id) ?? 0;
      seen.set(event.slot.id, child + 1);
      return { event, key: `${event.slot.id}:${child}` };
    });
  });
  const sung = new Set(keyed.flat().filter(({ event }) => event.lyric).map(({ key }) => key));
  const rows = keyed.map(list => list.filter(({ key }) => sung.has(key)).map(({ event }) => event));
  const points = new Map<string, Fraction>();
  for (const events of rows) for (const event of events) {
    points.set(event.start.toFraction(), event.start);
    const end = eventEnd(event);
    points.set(end.toFraction(), end);
    let bar = event.start.div(song.time[0]).floor().add(1).mul(song.time[0]);
    for (let count = 0; count < 512 && bar.compare(end) < 0; count++, bar = bar.add(song.time[0])) points.set(bar.toFraction(), bar);
  }
  const boundaries = [...points.values()].sort((left, right) => left.compare(right));
  if (boundaries.length < 2) return '';
  const active = (events: Event[], at: Fraction) => events.find(event => event.start.compare(at) <= 0 && eventEnd(event).compare(at) > 0);
  const intervals = boundaries.slice(0, -1).map((start, index) => ({ start, end: boundaries[index + 1] }))
    .filter(({ start }) => rows.some(events => active(events, start)));
  if (!intervals.length) return '';
  const widths = intervals.map(({ start, end }) => Math.max(72, Math.min(150, 40 + end.sub(start).valueOf() * 25)));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const verseNumber = (section: Section) => section.number || song.sections.filter(item => item.type === section.type).indexOf(section) + 1;
  const verseLabel = (section: Section) => {
    const number = verseNumber(section);
    const title = sectionTitle(section);
    if (title.toLowerCase() === `${section.type} ${number}`.toLowerCase()) return `${number}.`;
    const prefix = `${section.type} `;
    const suffix = title.toLowerCase().startsWith(prefix.toLowerCase()) ? title.slice(prefix.length).trim() : '';
    return /^\d+(?:[.-]\d+)*[a-z]?\.?$/i.test(suffix) ? suffix : title;
  };
  const labelWidth = line === 0 ? Math.max(28, Math.min(180, Math.max(...group.map(({ section }) => verseLabel(section).length)) * 6 + 10)) : 28;
  // A column ends a measure when a barline falls between its end and the next column shown (skipped notes may lie between).
  const measureEnd = (end: Fraction) => {
    const next = intervals.find(interval => interval.start.compare(end) >= 0)?.start ?? boundaries[boundaries.length - 1];
    return end.div(song.time[0]).ceil().mul(song.time[0]).compare(next) <= 0 ? ' measure-end' : '';
  };
  const chordRow = intervals.map(({ start, end }) => `<td class="score-chord${measureEnd(end)}">${combinedVariants(group.map((performance, index) => ({
    value: escape(active(rows[index], start)?.chord || '\u2014'), number: verseNumber(performance.section),
  })))}</td>`).join('');
  const lyricRows = group.map((performance, index) => {
    const number = verseNumber(performance.section);
    return `<tr class="score-verse-row" aria-label="${escape(sectionTitle(performance.section))}"><th class="score-verse-number" scope="row">${line === 0 ? escape(verseLabel(performance.section)) : ''}</th>${rows[index].map(event => {
      const end = eventEnd(event);
      const span = intervals.filter(interval => interval.start.compare(event.start) >= 0 && interval.start.compare(end) < 0).length;
      return `<td class="score-word${measureEnd(end)}" colspan="${Math.max(1, span)}">${escape(event.lyric || '\u2014')}${event.breathAfter ? '<span class="score-breath" aria-label="Breath"> ,</span>' : ''}</td>`;
    }).join('')}</tr>`;
  }).join('');
  const bellRow = intervals.map(({ start, end }) => `<td class="score-bell-cell${measureEnd(end)}">${combinedVariants(group.map((performance, index) => ({
    value: bellMarkers(song, active(rows[index], start), start), number: verseNumber(performance.section),
  })))}</td>`).join('');
  return `<div class="score-line score-conductor-line"><table class="score-conductor-table" style="min-width:${labelWidth + totalWidth}px" aria-label="${escape(group[0].section.type)} line ${line + 1}">
    <colgroup><col class="score-number-column" style="width:${labelWidth}px">${widths.map(width => `<col style="width:calc((100% - ${labelWidth}px) * ${width / totalWidth})">`).join('')}</colgroup><tbody>
    <tr class="score-chord-row"><td></td>${chordRow}</tr>${lyricRows}<tr class="score-bell-row"><td></td>${bellRow}</tr></tbody></table></div>`;
}

function conductor(song: Song, performances: Performance[]): string {
  const groups = new Map<string, Performance[]>();
  for (const performance of performances) groups.set(performance.section.type, [...(groups.get(performance.section.type) || []), performance]);
  const blocks = [...groups].map(([type, group]) => {
    const lines = [...new Set(group.flatMap(performance => performance.events.map(event => event.line)))].sort((a, b) => a - b);
    return `<section class="score-section score-conductor-section"><h4>${escape(type)}</h4>${lines.map(line => conductorLine(song, group, line)).join('')}</section>`;
  }).join('');
  const bells = playableBells(song);
  const counts = new Map(bells.map(bell => [bell, 0]));
  for (const { events } of performances) for (const event of events) for (const bell of event.strike) counts.set(bell, (counts.get(bell) || 0) + 1);
  return `${blocks}<ul class="score-play-counts" aria-label="Bell play counts">${bells.map(bell => {
      const count = counts.get(bell)!;
      return `<li class="score-count-item" data-bell="${escape(bell)}"><span class="score-count-note" style="--bell:${COLORS[pc(bell)]};--bell-ink:var(--${pc(bell) < 2 ? 'score-bell-dark-ink' : 'score-bell-ink'})">${escape(bellLabel(song, bell))}</span><span class="score-play-count-label">${count} ${count === 1 ? 'play' : 'plays'}</span></li>`;
    }).join('')}</ul>`;
}

function playerLine(events: Event[], bell: string): string {
  return `<p class="score-lyrics">${events.map(event => {
    const mark = event.lyric ? event.strike.includes(bell) ? ' score-lyric-strike' : event.damp.includes(bell) ? ' score-lyric-damp' : '' : '';
    return `<span class="score-lyric${mark}">${escape(event.lyric)}</span>${event.breathAfter ? '<span class="score-breath" aria-label="Breath" title="Breath">\u2016</span>' : ''}`;
  }).join(' ')}</p>`;
}


type Pair = [string, string];
const bellStyle = (bell: string) => `--bell:${COLORS[pc(bell)]};--bell-ink:var(--${pc(bell) < 2 ? 'score-bell-dark-ink' : 'score-bell-ink'})`;
const songTitle = (song: Song) => [song.hymnNumber.trim(), song.title.trim()].filter(Boolean).join(' ') + (song.key.trim() ? ` (${song.key.trim()})` : '');

// Both bells of a combined sheet share one lyric line, in the order they were chosen. A struck word is boxed in
// its bell's color, with the first bell's box around the second's; a damped word is underscored, the first
// bell's mark below the second's.
function combinedLine(song: Song, events: Event[], [low, high]: Pair): string {
  return `<p class="score-lyrics score-combo-lyrics">${events.map(event => {
    const breath = event.breathAfter ? '<span class="score-breath" aria-label="Breath" title="Breath">\u2016</span>' : '';
    if (!event.lyric) return breath;
    const struck = [low, high].filter(bell => event.strike.includes(bell));
    const damped = [high, low].filter(bell => event.damp.includes(bell));
    const names = struck.map(bell => `<small style="${bellStyle(bell)}">${escape(bellLabel(song, bell))}</small>`).join('');
    const box = (bell: string | undefined, inner: string) => `<span class="score-combo-box" style="--mark:${bell ? COLORS[pc(bell)] : 'var(--transparent)'}">${inner}</span>`;
    const word = box(struck[0], box(struck[1], `<span class="score-lyric">${escape(event.lyric)}</span>`));
    const marks = damped.map(bell => `<i style="--mark:${COLORS[pc(bell)]}"></i>`).join('');
    const label = [...struck.map(bell => `${bellLabel(song, bell)} strike`), ...damped.map(bell => `${bellLabel(song, bell)} damp`)].join(', ');
    return `<span class="score-combo-item"${label ? ` aria-label="${escape(event.lyric)}: ${escape(label)}"` : ''}><span class="score-combo-names">${names}</span>${word}<span class="score-combo-damps">${marks}</span></span>${breath}`;
  }).join(' ')}</p>`;
}

function combinedHeading(song: Song, pair: Pair): string {
  return `<header class="score-player-heading score-combo-heading"><div class="score-player-notes">${pair.map(bell =>
    `<div class="score-player-note" style="${bellStyle(bell)}">${escape(bellLabel(song, bell))}</div>`).join('')}</div><h3 class="score-player-title">${escape(songTitle(song))}</h3></header>`;
}

function playerHeading(song: Song, bell: string): string {
  const pitch = pc(bell);
  const label = bellLabel(song, bell);
  return `<header class="score-player-heading"><div class="score-player-note" style="--bell:${COLORS[pitch]};--bell-ink:var(--${pitch < 2 ? 'score-bell-dark-ink' : 'score-bell-ink'})">${escape(label)}</div><h3 class="score-player-title">${escape(songTitle(song))}</h3></header>`;
}

export function scoreMarkup(song: Song): string {
  const performances = song.sections.filter(section => !['lyrics', 'suggestions'].includes(section.stage)).map(section => ({ section, events: perform(song, section) }));
  const panels: (string | Pair | undefined)[] = [undefined, ...playableBells(song), ...combinedPairs(song)];
  const partLabel = (part: string | Pair | undefined) => !part ? 'Conductor' : typeof part === 'string' ? bellLabel(song, part) : part.map(bell => bellLabel(song, bell)).join(' + ');
  const partBells = (part: string | Pair | undefined) => !part ? [] : typeof part === 'string' ? [part] : part;
  const sections = (part: string | Pair) => performances.map(({ section, events }) => {
    const lineNumbers = [...new Set(events.map(event => event.line))];
    return `<section class="score-section"><h4>${escape(sectionTitle(section))}</h4>${lineNumbers.map(line => {
      const lineEvents = events.filter(event => event.line === line);
      return typeof part === 'string' ? playerLine(lineEvents, part) : combinedLine(song, lineEvents, part);
    }).join('')}</section>`;
  }).join('');
  return `<div class="score-root"><header class="score-heading"><div><p class="score-eyebrow">RINGALONG${song.hymnNumber ? ` / ${escape(song.hymnNumber)}` : ''}</p>
    <h2>${escape(song.title)}</h2><p>${escape(song.key)} <span aria-hidden="true"> / </span> ${song.time.join('/')} ${song.pickup ? ` / ${song.pickup}-beat pickup` : ''}</p></div>
    <button class="score-print" type="button" data-print title="Print all parts">Print</button></header>
    <div class="score-tabs" role="tablist" aria-label="Score parts">${panels.map((part, index) => `<button role="tab" type="button" data-score-tab="${index}" aria-label="${escape(partLabel(part))}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" style="--bell:${part ? COLORS[pc(partBells(part)[0])] : 'var(--green)'}">${part ? `${partBells(part).map(bell => `<i style="background:${COLORS[pc(bell)]}"></i>`).join('')}${escape(partLabel(part))}` : 'Conductor'}</button>`).join('')}</div>
    ${panels.map((part, panel) => `<section class="score-panel" data-score-panel="${panel}" role="tabpanel" aria-label="${escape(partLabel(part))}" ${panel ? 'hidden' : ''}>
      ${!part ? '<h3 class="score-part-title">Conductor</h3>' : typeof part === 'string' ? playerHeading(song, part) : combinedHeading(song, part)}
      ${part ? sections(part) : conductor(song, performances)}
    </section>`).join('')}
    <footer class="score-credit">${escape(song.credit).replace(/\r?\n/g, '<br>')}</footer></div>`;
}

export function bindScore(root: HTMLElement) {
  const activate = (tab: HTMLElement) => {
    const index = tab.dataset.scoreTab;
    root.querySelectorAll<HTMLElement>('[data-score-tab]').forEach(button => {
      const active = button.dataset.scoreTab === index;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    });
    root.querySelectorAll<HTMLElement>('[data-score-panel]').forEach(panel => { panel.hidden = panel.dataset.scorePanel !== index; });
  };
  root.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const tab = target.closest<HTMLElement>('[data-score-tab]');
    if (tab) activate(tab);
    if (target.closest('[data-print]')) window.print();
  });
  root.addEventListener('keydown', event => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-score-tab]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...root.querySelectorAll<HTMLElement>('[data-score-tab]')];
    let index = tabs.indexOf(tab);
    index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); activate(tabs[index]); tabs[index].focus();
  });
}

export const scoreRuntime = `(${bindScore.toString()})(document.querySelector('.score-root'));`;