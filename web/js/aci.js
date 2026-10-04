// AutoCAD Renk İndeksi (ACI) -> hex. 1-9 standart renkler, 10-249 ton
// tablosu (24 ton x 10 varyant), 250-255 gri tonları. Yaklaşık değerlerdir.

const BASE = {
  1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff',
  6: '#ff00ff', 7: '#e8e8e8', 8: '#808080', 9: '#c0c0c0',
};
const GRAYS = ['#333333', '#505050', '#696969', '#828282', '#bebebe', '#ffffff'];

function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return '#' + to(f(5)) + to(f(3)) + to(f(1));
}

export function aciToHex(i) {
  if (BASE[i]) return BASE[i];
  if (i >= 250 && i <= 255) return GRAYS[i - 250];
  if (i >= 10 && i <= 249) {
    const hue = (Math.floor(i / 10) - 1) * 15;
    const k = i % 10;
    const v = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][k];
    const s = k % 2 === 0 ? 1 : 0.5;
    return hsvToHex(hue, s, v);
  }
  return '#c8c8c8';
}
