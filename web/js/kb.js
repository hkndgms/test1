// Bilgi bankası: katman adı -> tesisat sınıfı kuralları ve temizlik (yok sayma)
// kuralları. Yerleşik kurallar + yapay zekâdan / kullanıcıdan öğrenilen kurallar.
// Öğrenilenler tarayıcıda saklanır ve JSON olarak dışa/içe aktarılabilir.

const STORE_KEY = 'dwg2bim.kb.v1';

// Tesisat sistemleri: renk, IFC dağıtım sistemi türü
export const SYSTEMS = {
  coldwater: { label: 'Soğuk su', color: '#2f7de1', ifc: 'DOMESTICCOLDWATER' },
  hotwater: { label: 'Sıcak su', color: '#e5482f', ifc: 'DOMESTICHOTWATER' },
  recirc: { label: 'Sirkülasyon', color: '#f08a24', ifc: 'DOMESTICHOTWATER' },
  sewage: { label: 'Pis su', color: '#8a5a2b', ifc: 'SEWAGE' },
  rain: { label: 'Yağmur suyu', color: '#3f8f8f', ifc: 'RAINWATER' },
  condensate: { label: 'Yoğuşma / drenaj', color: '#6f8fa8', ifc: 'DRAINAGE' },
  vent: { label: 'Havalık', color: '#9c8a6a', ifc: 'VENT' },
  refrigerant: { label: 'VRF / soğutucu hat', color: '#9b3fd1', ifc: 'REFRIGERATION' },
  supplyair: { label: 'Üfleme / taze hava', color: '#14a37a', ifc: 'VENTILATION' },
  returnair: { label: 'Emiş / dönüş havası', color: '#5fb991', ifc: 'VENTILATION' },
  exhaust: { label: 'Egzost', color: '#7f9150', ifc: 'EXHAUST' },
  hvac: { label: 'Klima cihazları', color: '#b05cd6', ifc: 'AIRCONDITIONING' },
  heating: { label: 'Isıtma', color: '#d9534f', ifc: 'HEATING' },
  gas: { label: 'Gaz', color: '#d4b000', ifc: 'GAS' },
  fire: { label: 'Yangın / sprinkler', color: '#e0245e', ifc: 'FIREPROTECTION' },
  other: { label: 'Diğer mekanik', color: '#7d8590', ifc: 'NOTDEFINED' },
};

// Katman türleri
export const KINDS = {
  pipe: 'Boru (tek çizgi)',
  air: 'Kanal / menfez (kapalı şekil)',
  equipment: 'Cihaz (blok / şekil)',
  terminal: 'Uç birim / sembol (küçük)',
  ignore: 'Yok say',
};

// Kot referansı: 'ceiling' (asma tavan) veya 'floor' (döşeme) + fark (cm)
// sizeCm: boru çapı / cihaz yüksekliği; heightCm: kanal yüksekliği
const R = (pattern, kind, system, elevRef, elevOffsetCm, sizeCm, note) => ({ pattern, kind, system, elevRef, elevOffsetCm, sizeCm, note, source: 'builtin' });

export const BUILTIN_IGNORE = [
  { pattern: 'SUPERPOZE|SUPERPOSE|OVERLAY|UNDERLAY', reason: 'Başka projeden üst üste bindirilmiş referans' },
  { pattern: 'SPRINK\\w*\\s*CIRCLE|COVERAGE|ETKI ALAN', reason: 'Sprinkler etki dairesi (fiziksel değil)' },
  { pattern: 'YAZI|TEXT|TXT|LETTER|TANIM|ETIKET|TAG\\b|NOTE|\\bNOT\\b|DATA|CERCEVE|ANTET|PAFTA|LEJANT|LEGEND|TITLE', reason: 'Yazı / açıklama' },
  { pattern: 'OLCU|\\bDIM|AKS|AXIS|\\bKOT\\b|-KOT|LEVEL MARK', reason: 'Ölçü / aks / kot işareti' },
  { pattern: 'TARAMA|HATCH|\\bTRM\\b|-TRM', reason: 'Tarama' },
  { pattern: 'REZERVASYON|RESERVATION|SLEEVE', reason: 'Rezervasyon / kılıf işareti' },
  { pattern: 'MAHAL|ROOM LOAD|\\bYUK\\b', reason: 'Mahal yükü / mahal bilgisi' },
  { pattern: 'AGAC|TREE|BITKI|PLANT|INSAN|PEOPLE|HUMAN|ARABA|CAR\\b|PEYZAJ|LANDSCAPE', reason: 'Peyzaj / insan / araç' },
  { pattern: 'DEFPOINTS|VIEWPORT|\\bVP\\b', reason: 'Yardımcı katman' },
];

export const BUILTIN_RULES = [
  R('SPRINK[\\w\\s._-]*(PIPE|BORU)|YANGIN[\\w\\s._-]*BORU|FIRE[\\w\\s._-]*PIPE|TEST[\\s._-]*DRENAJ|YANGIN[\\s._-]*DRENAJ', 'pipe', 'fire', 'ceiling', -15, 5, 'Yangın / sprinkler borusu'),
  R('SPRINK', 'terminal', 'fire', 'ceiling', -5, 6, 'Sprinkler başlığı'),
  R('SONDURME|EXTINGUISH|\\bTUP', 'equipment', 'fire', 'floor', 0, 60, 'Yangın söndürme tüpü'),
  R('\\bIKV\\b|YANGIN\\s*DOLAB|HYDRANT|\\bFHC\\b', 'equipment', 'fire', 'floor', 60, 90, 'Yangın dolabı'),
  R('SOGUK|COLD|TEMIZ\\s*SU|\\bCW\\b|SEBEKE|FRESH\\s*WATER|WATER\\s*SUPPLY', 'pipe', 'coldwater', 'ceiling', -20, 2.5, 'Soğuk su borusu'),
  R('SICAK|HOT\\s*WATER|\\bHW\\b|KULLANIM\\s*SICAK', 'pipe', 'hotwater', 'ceiling', -25, 2.5, 'Sıcak su borusu'),
  R('SIRK|CIRCULATION|RECIRC', 'pipe', 'recirc', 'ceiling', -30, 2, 'Sirkülasyon borusu'),
  R('HAVALIK|VENT\\s*PIPE|VENTILATION\\s*PIPE', 'pipe', 'vent', 'ceiling', -10, 7, 'Havalık borusu'),
  R('PISSU|PIS\\s*SU|WASTE|SEWAGE|ATIK\\s*SU|YAGLI|SOIL', 'pipe', 'sewage', 'floor', -40, 10, 'Pis su borusu (döşeme altı)'),
  R('YAGMUR|RAIN|STORM', 'pipe', 'rain', 'floor', -40, 10, 'Yağmur suyu borusu'),
  R('DRENAJ|DRAIN|CONDENS|YOGUSMA', 'pipe', 'condensate', 'ceiling', -30, 3.2, 'Yoğuşma / drenaj borusu'),
  R('VRF[\\w\\s._-]*(BORU|PIPE|HAT)|GAZ\\s*HATTI|LIKIT|LIQUID\\s*LINE|REFRIG|BAKIR', 'pipe', 'refrigerant', 'ceiling', -20, 1.6, 'VRF soğutucu akışkan borusu'),
  R('DOGALGAZ|NATURAL\\s*GAS|\\bGAS\\s*PIPE', 'pipe', 'gas', 'ceiling', -20, 2.5, 'Gaz borusu'),
  R('RADYATOR|RADIATOR|ISITMA|HEATING|KALORIFER', 'pipe', 'heating', 'floor', 20, 2.5, 'Isıtma tesisatı'),
  R('EGZOST|EXHAUST|ASPIRAT', 'air', 'exhaust', 'ceiling', 0, 30, 'Egzost kanalı / menfezi'),
  R('EMIS|RETURN', 'air', 'returnair', 'ceiling', 0, 30, 'Emiş (dönüş) kanalı / menfezi'),
  R('FLEX', 'air', 'supplyair', 'ceiling', -10, 20, 'Esnek (flex) kanal'),
  R('UFLEME|SUPPLY|TAZE\\s*HAVA|FRESH\\s*AIR|SLOT|DIFUZOR|DIFFUSER|MENFEZ|GRILL|\\bK\\.?A\\b|\\bG\\.?A\\b|HVAC|KANAL|DUCT', 'air', 'supplyair', 'ceiling', 0, 30, 'Üfleme / taze hava kanalı veya menfezi'),
  R('VRF|KLIMA|DAIKIN|MITSUBISHI|TOSHIBA|LG\\b|SPLIT|\\bFCU\\b|FANCOIL|IC\\s*UNITE|INDOOR|OUTDOOR|DIS\\s*UNITE|SANTRAL|\\bAHU\\b', 'equipment', 'hvac', 'ceiling', -30, 30, 'Klima / VRF cihazı'),
  R('VANA|VALVE|FLATOR|PISLIK\\s*TUTUCU|STRAINER|SAYAC|METER', 'terminal', 'other', 'ceiling', -20, 10, 'Vana / armatür sembolü'),
  R('\\bMK\\b|MANHOLE|ROGAR|MUAYENE|BACA', 'equipment', 'sewage', 'floor', -10, 10, 'Rögar / muayene bacası'),
  R('HIDROFOR|POMPA|PUMP|KAZAN|BOILER|BOYLER|DEPO|TANK|ISITICI|HEATER|KOLLEKTOR|COLLECTOR|EKSPANSIYON', 'equipment', 'other', 'floor', 0, 120, 'Mekanik oda cihazı'),
  R('CIHAZ|EQUIP|TERMOSTAT|THERMOSTAT|SENSOR', 'equipment', 'other', 'floor', 140, 12, 'Duvar tipi cihaz (termostat, sensör)'),
  R('^M[-_ ].*TEFRIS|MEKANIK\\s*TEFRIS', 'equipment', 'other', 'floor', 0, 80, 'Mekanik tefriş (cihaz sembolleri)'),
];

// Türkçe karakterleri katlayıp büyük harfe çevir (eşleştirme için)
export function fold(s) {
  return String(s || '')
    .replace(/[İIı]/g, 'I').replace(/[Şş]/g, 'S').replace(/[Ğğ]/g, 'G')
    .replace(/[Üü]/g, 'U').replace(/[Öö]/g, 'O').replace(/[Çç]/g, 'C')
    .toUpperCase();
}

// "prefix$0$KATMAN" biçimli dış referans katmanlarını ayır
export function splitXref(name) {
  const i = name.lastIndexOf('$0$');
  return i >= 0 ? { xref: name.slice(0, i), base: name.slice(i + 3) } : { xref: '', base: name };
}

const safeRe = (p) => { try { return new RegExp(p, 'i'); } catch { return null; } };

export class KnowledgeBase {
  constructor() {
    this.learned = []; // {pattern, kind, system, elevRef, elevOffsetCm, sizeCm, note, source:'ai'|'user', created}
    this.ignore = []; // {pattern, reason, source}
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const j = JSON.parse(raw);
      this.learned = Array.isArray(j.learned) ? j.learned : [];
      this.ignore = Array.isArray(j.ignore) ? j.ignore : [];
    } catch { /* depolama kapalı olabilir */ }
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.toJSON())); } catch { /* yoksay */ }
  }

  toJSON() { return { format: 'dwg2bim-kb', version: 1, saved: new Date().toISOString(), learned: this.learned, ignore: this.ignore }; }

  importJSON(j) {
    if (!j || j.format !== 'dwg2bim-kb') throw new Error('Bu bir DWG2BIM bilgi bankası dosyası değil.');
    let n = 0;
    for (const r of j.learned || []) if (this.addRule(r, r.source || 'user')) n++;
    for (const r of j.ignore || []) if (this.addIgnore(r, r.source || 'user')) n++;
    this.save();
    return n;
  }

  reset() { this.learned = []; this.ignore = []; this.save(); }

  addRule(r, source = 'ai') {
    if (!r || !r.pattern || !KINDS[r.kind] || !safeRe(r.pattern)) return false;
    if (r.kind !== 'ignore' && r.system && !SYSTEMS[r.system]) r.system = 'other';
    const i = this.learned.findIndex((x) => x.pattern === r.pattern);
    const rule = {
      pattern: String(r.pattern), kind: r.kind, system: r.system || 'other',
      elevRef: r.elevRef === 'floor' ? 'floor' : 'ceiling',
      elevOffsetCm: Number.isFinite(+r.elevOffsetCm) ? +r.elevOffsetCm : 0,
      sizeCm: Number.isFinite(+r.sizeCm) && +r.sizeCm > 0 ? +r.sizeCm : null,
      note: String(r.note || '').slice(0, 200), source, created: new Date().toISOString(),
    };
    if (i >= 0) this.learned[i] = rule; else this.learned.unshift(rule);
    return true;
  }

  addIgnore(r, source = 'ai') {
    if (!r || !r.pattern || !safeRe(r.pattern)) return false;
    if (this.ignore.some((x) => x.pattern === r.pattern)) return false;
    this.ignore.unshift({ pattern: String(r.pattern), reason: String(r.reason || '').slice(0, 200), source, created: new Date().toISOString() });
    return true;
  }

  // Bir katman için karar: {kind, system, elevRef, elevOffsetCm, sizeCm, source, note, xref}
  classify(name) {
    const { xref, base } = splitXref(name);
    const f = fold(base);
    const full = fold(name);
    for (const r of this.ignore) { const re = safeRe(r.pattern); if (re && (re.test(f) || re.test(full))) return { kind: 'ignore', source: r.source || 'ai', note: r.reason, xref }; }
    for (const r of this.learned) { const re = safeRe(r.pattern); if (re && (re.test(f) || re.test(full))) return { ...r, xref }; }
    for (const r of BUILTIN_IGNORE) if (safeRe(r.pattern).test(f) || safeRe(r.pattern).test(full)) return { kind: 'ignore', source: 'builtin', note: r.reason, xref };
    const mepish = /^M[-_ ]|^MEK|TESISAT|MECH|PLUMB|HVAC|VRF|YANGIN|FIRE/.test(f);
    for (const r of BUILTIN_RULES) if (safeRe(r.pattern).test(f)) {
      // Dış referanstan gelen tesisat katmanı: büyük ihtimalle başka bir çizimin kalıntısı
      if (xref && !/BRK|ARCH|MIMARI/i.test(fold(xref))) return { ...r, kind: 'ignore', source: 'builtin', note: 'Dış referanstan bağlanmış (başka çizim): ' + xref, xref, wouldBe: r.kind };
      return { ...r, xref };
    }
    return { kind: mepish ? null : 'ignore', source: mepish ? 'unknown' : 'builtin', note: mepish ? 'Bilinmeyen tesisat katmanı' : 'Tesisat dışı katman', xref, unknown: mepish };
  }

  stats() {
    return { learned: this.learned.length, ignore: this.ignore.length, builtin: BUILTIN_RULES.length + BUILTIN_IGNORE.length };
  }
}
