// Passwort-Schranke vor dem Start. Reine Browser-Sache: der Code liegt offen im Netz, das hält also nur Neugierige ab,
// keine Entschlossenen. Gespeichert wird nur ein Hash (config.js), nie das Passwort selbst.
export const sha256 = (str) => {
  const K = Array.from({ length: 64 }, (_, i) => { let n = 2, c = 0; for (let p = 0; ; n++) { let prime = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; } if (prime && c++ === i) return Math.floor((n ** (1 / 3) % 1) * 2 ** 32) >>> 0; } });
  let H = [2, 3, 5, 7, 11, 13, 17, 19].map((p) => Math.floor((p ** 0.5 % 1) * 2 ** 32) >>> 0);
  const bytes = [...new TextEncoder().encode(str)], bitLen = bytes.length * 8;
  bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < bytes.length; o += 64) {
    const w = new Array(64);
    for (let i = 0; i < 16; i++) w[i] = (bytes[o + i * 4] << 24) | (bytes[o + i * 4 + 1] << 16) | (bytes[o + i * 4 + 2] << 8) | bytes[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H = H.map((v, i) => (v + [a, b, c, d, e, f, g, h][i]) | 0);
  }
  return H.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
};

export const hashPassword = (pw) => sha256(`altlasten:${pw.trim()}`);
export const checkPassword = (pw, hash) => hashPassword(pw) === hash;
