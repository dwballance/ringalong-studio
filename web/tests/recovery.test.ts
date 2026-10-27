import { beforeEach, describe, expect, it } from 'vitest';
import { newSong } from '../src/document';
import { Recovery } from '../src/recovery';

describe('local recovery', () => {
  beforeEach(() => localStorage.clear());
  it('recovers incomplete documents locally', () => {
    const song = newSong(); song.title = 'Draft'; const recovery = new Recovery(); recovery.save(song);
    expect(new Recovery().restore()).toEqual(song);
  });
  it('clears and disables retention', () => {
    const recovery = new Recovery(); recovery.save(newSong()); recovery.setEnabled(false); recovery.save(newSong());
    expect(new Recovery().enabled).toBe(false); expect(new Recovery().restore()).toBeUndefined();
  });
  it('continues when storage is denied', () => {
    const denied = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); }, removeItem() { throw new Error('Denied'); } } as unknown as Storage;
    const recovery = new Recovery(denied); expect(() => recovery.save(newSong())).not.toThrow();
    expect(recovery.error).toContain('unavailable');
  });
});