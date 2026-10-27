import { songSchema, type Song } from './document';

const DRAFT = 'ringalong.draft.v1';
const ENABLED = 'ringalong.recovery.enabled';
export class Recovery {
  enabled = true;
  error = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private storage: Storage | undefined;
  constructor(storage?: Storage) {
    try { this.storage = storage || window.localStorage; this.enabled = this.storage.getItem(ENABLED) !== 'false'; }
    catch { this.error = 'Browser storage unavailable. Export to keep your work.'; }
  }
  restore(): Song | undefined {
    if (!this.enabled) return;
    try {
      const source = this.storage?.getItem(DRAFT);
      if (!source) return;
      if (source.length > 8 * 1024 * 1024) throw new Error('Draft too large');
      return songSchema.parse(JSON.parse(source));
    } catch { this.error = 'Recovery draft could not be opened. You can still import a saved file.'; }
  }
  schedule(song: Song, onSaved?: () => void) {
    clearTimeout(this.timer);
    if (this.enabled) {
      this.timer = setTimeout(() => { this.save(song); onSaved?.(); }, 350);
    }
  }
  save(song: Song) {
    clearTimeout(this.timer);
    if (!this.enabled) return;
    try { if (!this.storage) throw new Error('Storage unavailable'); this.storage.setItem(DRAFT, JSON.stringify(song)); this.error = ''; }
    catch { this.error = 'Recovery storage is full or unavailable. Export to keep your work.'; }
  }
  clear() {
    clearTimeout(this.timer);
    try { if (!this.storage) throw new Error('Storage unavailable'); this.storage.removeItem(DRAFT); this.error = ''; }
    catch { this.error = 'Browser storage could not be cleared.'; }
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.clear();
    try { if (!this.storage) throw new Error('Storage unavailable'); this.storage.setItem(ENABLED, String(enabled)); }
    catch { this.error = 'Recovery preference could not be saved.'; }
  }
}