// Kalıcı öğe kütüphanesi: Claude'un (ya da kullanıcının) tanımladığı tefriş / sembol türleri.
// Tarayıcıda saklanır (localStorage), sonraki oturumlarda blok adlarını tanımak ve
// "şuraya X koy" denince çağırmak için kullanılır. JSON dışa/içe aktarılabilir.
//
// Öğe: { name, label, kind (temel tür: table, chair, wc, ac... ya da 'ignore'), sizeCm: [en, derinlik],
//        parts?: [{ x, y, w, d, z0, z1, mat }]  (cm, yerel: x sağa, y arkadan öne; yoksa temel türün parametrik modeli)
//        aliases?: [regex]  (katlanmış BÜYÜK harf blok adı üzerinde), note, source, created }
// Ayrıca uzun süreli bellek kayıtları: kind 'note' (metin bilgi: kural, tecrübe, standart değerler) ve
// kind 'recipe' (çizim tarifi: ör. yerden ısıtma parametreleri). Hepsi aynı kütüphanede tutulur.
// Depolama: localStorage (bu tarayıcı) + varsa artifact 'db' (paylaşımlı; diğer kullanıcılar da okur).

import { fold } from './kb.js';
import { FIXTURE_KINDS } from './fixtures.js';

const STORE = 'dwg2bim.lib.v1';
const MEMORY_KINDS = new Set(['note', 'recipe']);
const MATS = new Set(['frame', 'leaf', 'wframe', 'mullion', 'glass', 'sillstone', 'ceramic', 'seat', 'chrome', 'metal', 'wood', 'fabric', 'water']);
const safeRe = (p) => { try { return new RegExp(p, 'i'); } catch { return null; } };

export class Library {
  constructor() { this.items = []; this.db = null; this.load(); }
  // Paylaşımlı depo (artifact db): koleksiyon 'library', belge kimliği = name. Yerel ile birleştirir.
  async attach(db) {
    if (!db) return 0;
    this.db = db;
    try {
      const snap = await db.collection('library').get();
      let n = 0;
      for (const doc of snap.docs || []) {
        const it = doc.data();
        if (!it || !it.name) continue;
        const cur = this.items.find((x) => x.name === it.name);
        if (!cur || (it.updated || '') > (cur.updated || '')) { if (cur) Object.assign(cur, it); else this.items.push(it); n++; }
      }
      try { localStorage.setItem(STORE, JSON.stringify(this.toJSON())); } catch { /* yoksay */ }
      // yerelde olup paylaşımlıda olmayanları yükle (ilk eşitleme)
      for (const it of this.items) if (!(snap.docs || []).some((d) => d.id === it.name)) this._push(it);
      return n;
    } catch (e) { console.warn('kütüphane db okunamadı', e); return 0; }
  }
  _push(it) { if (!this.db) return; this.db.collection('library').doc(it.name).set(it).catch((e) => console.warn('kütüphane yazılamadı', e?.code || e)); }
  _drop(name) { if (!this.db) return; this.db.collection('library').doc(name).delete().catch(() => {}); }
  load() {
    try { const j = JSON.parse(localStorage.getItem(STORE) || 'null'); if (j && Array.isArray(j.items)) this.items = j.items; } catch { /* depolama kapalı olabilir */ }
  }
  save() { try { localStorage.setItem(STORE, JSON.stringify(this.toJSON())); } catch { /* yoksay */ } }
  toJSON() { return { format: 'dwg2bim-lib', version: 1, saved: new Date().toISOString(), items: this.items }; }
  importJSON(j) {
    const items = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
    let n = 0;
    for (const it of items) if (this.add(it, it.source || 'import')) n++;
    return n;
  }
  get(name) { const k = String(name || '').toLowerCase(); return this.items.find((i) => i.name === k) || null; }
  list() { return this.items; }
  remove(name) { const k = String(name || '').toLowerCase(); const n = this.items.length; this.items = this.items.filter((i) => i.name !== k); if (this.items.length !== n) { this.save(); this._drop(k); } return this.items.length !== n; }
  notes(filter = '') { const f = filter.toLowerCase(); return this.items.filter((i) => MEMORY_KINDS.has(i.kind) && (!f || (i.name + ' ' + i.label + ' ' + (i.text || '') + ' ' + (i.tags || []).join(' ')).toLowerCase().includes(f))); }
  fixtures() { return this.items.filter((i) => !MEMORY_KINDS.has(i.kind)); }

  // Doğrulayıp ekler / günceller. Döndürür: kayıt ya da null (geçersiz)
  add(def, source = 'ai') {
    if (!def || typeof def !== 'object') return null;
    const name = String(def.name || '').trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40);
    if (!name) return null;
    const kind = String(def.kind || 'cabinet').toLowerCase();
    if (MEMORY_KINDS.has(kind)) {
      // uzun süreli bellek kaydı: metin + etiketler (+ tarif parametreleri)
      const text = String(def.text || def.note || '').slice(0, 4000);
      if (!text) return null;
      const rec = { name, label: String(def.label || def.name).slice(0, 80), kind, text, tags: (Array.isArray(def.tags) ? def.tags : []).map(String).slice(0, 12), params: def.params && typeof def.params === 'object' ? def.params : null, source, created: new Date().toISOString(), updated: new Date().toISOString() };
      const i = this.items.findIndex((x) => x.name === name);
      if (i >= 0) this.items[i] = { ...this.items[i], ...rec, created: this.items[i].created }; else this.items.push(rec);
      this.save(); this._push(rec);
      return rec;
    }
    if (kind !== 'ignore' && !FIXTURE_KINDS[kind]) return null;
    const size = Array.isArray(def.sizeCm) && def.sizeCm.length === 2 ? def.sizeCm.map((v) => Math.max(2, Math.min(2000, +v || 0))) : (FIXTURE_KINDS[kind]?.size || [50, 50]);
    const parts = Array.isArray(def.parts) ? def.parts.map((p) => ({
      x: +p.x || 0, y: +p.y || 0, w: Math.max(1, +p.w || 10), d: Math.max(1, +p.d || 10), z0: Math.max(0, +p.z0 || 0), z1: Math.max(0.5, +p.z1 || 50),
      mat: MATS.has(p.mat) ? p.mat : 'wood', shape: p.shape === 'oval' ? 'oval' : 'box',
    })).filter((p) => p.z1 > p.z0).slice(0, 40) : null;
    const aliases = (Array.isArray(def.aliases) ? def.aliases : []).map(String).filter((a) => a && safeRe(a)).slice(0, 12);
    const rec = { name, label: String(def.label || def.name).slice(0, 60), kind, sizeCm: size, parts: parts && parts.length ? parts : null, aliases, note: String(def.note || '').slice(0, 200), source, created: new Date().toISOString(), updated: new Date().toISOString() };
    const i = this.items.findIndex((x) => x.name === name);
    if (i >= 0) this.items[i] = { ...this.items[i], ...rec, created: this.items[i].created };
    else this.items.push(rec);
    this.save(); this._push(rec);
    return rec;
  }

  // Blok adı -> kütüphane öğesi (takma ad eşleşmesi; ad katlanmış büyük harf)
  matchBlock(blockName) {
    const f = fold(blockName);
    for (const it of this.items) for (const a of it.aliases || []) { const re = safeRe(a); if (re && re.test(f)) return it; }
    return null;
  }
  stats() { return { items: this.items.length, notes: this.items.filter((i) => MEMORY_KINDS.has(i.kind)).length, shared: !!this.db }; }
}
