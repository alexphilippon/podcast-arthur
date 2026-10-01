/* Remux d'un MP4 fragmenté (sortie de MediaRecorder) vers un MP4 classique :
   durée correcte dans l'en-tête, index complet, moov avant mdat. Aucun réencodage. */

const enc = new TextEncoder();
const dec = new TextDecoder("latin1");

function boxes(buf, start, end) {
  const dv = new DataView(buf), out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o), hdr = 8;
    const type = String.fromCharCode(dv.getUint8(o + 4), dv.getUint8(o + 5), dv.getUint8(o + 6), dv.getUint8(o + 7));
    if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; }
    else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) break;
    out.push({ type, start: o, end: o + size, hdr });
    o += size;
  }
  return out;
}
function box(type, ...parts) {
  let len = 8;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len), dv = new DataView(out.buffer);
  dv.setUint32(0, len);
  out.set(enc.encode(type), 4);
  let o = 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function fullbox(type, version, flags, ...parts) {
  return box(type, new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);
}
function u32s(arr) {
  const a = new Uint8Array(arr.length * 4), d = new DataView(a.buffer);
  arr.forEach((v, i) => d.setUint32(i * 4, v >>> 0));
  return a;
}
function i32s(arr) {
  const a = new Uint8Array(arr.length * 4), d = new DataView(a.buffer);
  arr.forEach((v, i) => d.setInt32(i * 4, v | 0));
  return a;
}
function runs(values) {
  const out = [];
  for (const v of values) {
    const last = out[out.length - 1];
    if (last && last[1] === v) last[0]++; else out.push([1, v]);
  }
  return out;
}

export async function fixMp4(blob) {
  const buf = await blob.arrayBuffer();
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const top = boxes(buf, 0, buf.byteLength);
  const moov = top.find(b => b.type === "moov");
  const moofs = top.filter(b => b.type === "moof");
  if (!moov || !moofs.length) return null;

  const mk = boxes(buf, moov.start + moov.hdr, moov.end);
  const mvhd = mk.find(b => b.type === "mvhd");
  if (!mvhd) return null;
  const mvVer = u8[mvhd.start + mvhd.hdr];
  const mvTs = dv.getUint32(mvhd.start + mvhd.hdr + 4 + (mvVer === 1 ? 16 : 8));

  const trex = new Map();
  const mvex = mk.find(b => b.type === "mvex");
  if (mvex) {
    for (const t of boxes(buf, mvex.start + mvex.hdr, mvex.end)) {
      if (t.type !== "trex") continue;
      const o = t.start + t.hdr + 4;
      trex.set(dv.getUint32(o), { dur: dv.getUint32(o + 8), size: dv.getUint32(o + 12), flags: dv.getUint32(o + 16) });
    }
  }

  const tracks = new Map();
  for (const tb of mk.filter(b => b.type === "trak")) {
    const kids = boxes(buf, tb.start + tb.hdr, tb.end);
    const tkhd = kids.find(b => b.type === "tkhd"), mdia = kids.find(b => b.type === "mdia");
    if (!tkhd || !mdia) continue;
    const tv = u8[tkhd.start + tkhd.hdr];
    const id = dv.getUint32(tkhd.start + tkhd.hdr + 4 + (tv === 1 ? 16 : 8));
    const mk2 = boxes(buf, mdia.start + mdia.hdr, mdia.end);
    const mdhd = mk2.find(b => b.type === "mdhd"), hdlr = mk2.find(b => b.type === "hdlr"), minf = mk2.find(b => b.type === "minf");
    if (!mdhd || !hdlr || !minf) continue;
    const mv = u8[mdhd.start + mdhd.hdr];
    const ts = dv.getUint32(mdhd.start + mdhd.hdr + 4 + (mv === 1 ? 16 : 8));
    const handler = dec.decode(u8.subarray(hdlr.start + hdlr.hdr + 8, hdlr.start + hdlr.hdr + 12));
    const mif = boxes(buf, minf.start + minf.hdr, minf.end);
    const stbl = mif.find(b => b.type === "stbl");
    if (!stbl) continue;
    const stsd = boxes(buf, stbl.start + stbl.hdr, stbl.end).find(b => b.type === "stsd");
    if (!stsd) continue;
    tracks.set(id, { id, kids, tkhd, tv, mk2, mdhd, mv, mdia, ts, handler, minf, mif, stsd,
      sizes: [], durs: [], flags: [], ctos: [], chunks: [], trafs: [], ctoSigned: false, first: null, offs: [] });
  }

  const order = [];
  for (const mf of moofs) {
    const trafs = boxes(buf, mf.start + mf.hdr, mf.end).filter(b => b.type === "traf");
    for (const tf of trafs) {
      const tk = boxes(buf, tf.start + tf.hdr, tf.end);
      const tfhd = tk.find(b => b.type === "tfhd");
      if (!tfhd) continue;
      let o = tfhd.start + tfhd.hdr;
      const fl = dv.getUint32(o) & 0xffffff; o += 4;
      const id = dv.getUint32(o); o += 4;
      const t = tracks.get(id);
      if (!t) continue;
      const dflt = trex.get(id) || { dur: 0, size: 0, flags: 0 };
      let base = mf.start, dd = dflt.dur, ds = dflt.size, df = dflt.flags;
      if (fl & 1) { base = Number(dv.getBigUint64(o)); o += 8; }
      if (fl & 2) o += 4;
      if (fl & 8) { dd = dv.getUint32(o); o += 4; }
      if (fl & 0x10) { ds = dv.getUint32(o); o += 4; }
      if (fl & 0x20) { df = dv.getUint32(o); o += 4; }
      const tfdt = tk.find(b => b.type === "tfdt");
      let tval = null;
      if (tfdt) {
        const v = u8[tfdt.start + tfdt.hdr], p = tfdt.start + tfdt.hdr + 4;
        tval = v === 1 ? Number(dv.getBigUint64(p)) : dv.getUint32(p);
        if (t.first === null) t.first = tval;
      }
      t.trafs.push({ start: t.sizes.length, tfdt: tval });
      let cursor = base;
      for (const tr of tk.filter(b => b.type === "trun")) {
        let p = tr.start + tr.hdr;
        const ver = u8[p], tfl = dv.getUint32(p) & 0xffffff; p += 4;
        const n = dv.getUint32(p); p += 4;
        let pos = cursor;
        if (tfl & 1) { pos = base + dv.getInt32(p); p += 4; }
        let first = null;
        if (tfl & 4) { first = dv.getUint32(p); p += 4; }
        let at = pos;
        for (let i = 0; i < n; i++) {
          let d = dd, s = ds, f = df, c = 0;
          if (tfl & 0x100) { d = dv.getUint32(p); p += 4; }
          if (tfl & 0x200) { s = dv.getUint32(p); p += 4; }
          if (tfl & 0x400) { const sf = dv.getUint32(p); p += 4; if (!(i === 0 && first !== null)) f = sf; else f = first; }
          else if (i === 0 && first !== null) f = first;
          if (tfl & 0x800) { c = ver === 1 ? dv.getInt32(p) : dv.getUint32(p); p += 4; if (c < 0) t.ctoSigned = true; }
          t.sizes.push(s); t.durs.push(d); t.flags.push(f); t.ctos.push(c);
          at += s;
        }
        const chunk = { pos, len: at - pos, count: n };
        cursor = at;
        t.chunks.push(chunk);
        order.push({ t, chunk });
      }
    }
  }

  const used = [...tracks.values()].filter(t => t.sizes.length);
  if (!used.length) return null;

  // Durée du dernier échantillon de chaque fragment : déduite du tfdt du fragment suivant
  for (const t of used) {
    for (let i = 0; i < t.trafs.length; i++) {
      const tf = t.trafs[i], next = t.trafs[i + 1];
      const lastIdx = (next ? next.start : t.sizes.length) - 1;
      if (lastIdx < tf.start) continue;
      if (next && tf.tfdt !== null && next.tfdt !== null) {
        let dts = tf.tfdt;
        for (let k = tf.start; k < lastIdx; k++) dts += t.durs[k];
        const diff = next.tfdt - dts;
        if (diff > 0) t.durs[lastIdx] = diff;
      } else if (!next && t.durs[lastIdx] === 0 && lastIdx > 0) {
        t.durs[lastIdx] = t.durs[lastIdx - 1];
      }
    }
  }

  // Départ décalé entre pistes (relatif à la piste la plus précoce)
  const firsts = used.map(t => (t.first || 0) / t.ts);
  const minFirst = Math.min(...firsts);
  let movDur = 0;
  for (const t of used) {
    t.mediaDur = t.durs.reduce((a, b) => a + b, 0);
    t.delaySec = (t.first || 0) / t.ts - minFirst;
    t.delayMov = t.delaySec > 0.001 ? Math.round(t.delaySec * mvTs) : 0;
    t.movDur = t.delayMov + Math.round(t.mediaDur / t.ts * mvTs);
    movDur = Math.max(movDur, t.movDur);
  }

  const patch = (b, off, size, value) => {
    const c = u8.slice(b.start, b.end), d = new DataView(c.buffer);
    if (size === 8) d.setBigUint64(off, BigInt(value)); else d.setUint32(off, value >>> 0);
    return c;
  };

  function buildTrak(t) {
    const tkhdP = patch(t.tkhd, t.tkhd.hdr + 4 + (t.tv === 1 ? 24 : 16), t.tv === 1 ? 8 : 4, t.movDur);
    const mdhdP = patch(t.mdhd, t.mdhd.hdr + 4 + (t.mv === 1 ? 20 : 12), t.mv === 1 ? 8 : 4, t.mediaDur);

    const stts = fullbox("stts", 0, 0, u32s([runs(t.durs).length]), u32s(runs(t.durs).flat()));
    const parts = [new Uint8Array(buf, t.stsd.start, t.stsd.end - t.stsd.start).slice(), stts];

    if (t.handler === "vide") {
      const syncs = [];
      t.flags.forEach((f, i) => { if (!(f & 0x10000)) syncs.push(i + 1); });
      if (syncs.length && syncs.length < t.sizes.length) parts.push(fullbox("stss", 0, 0, u32s([syncs.length]), u32s(syncs)));
    }
    if (t.ctos.some(c => c !== 0)) {
      const r = runs(t.ctos);
      parts.push(fullbox("ctts", t.ctoSigned ? 1 : 0, 0, u32s([r.length]), (t.ctoSigned ? i32s : u32s)(r.flat())));
    }
    const sc = [];
    t.chunks.forEach((c, i) => {
      const last = sc[sc.length - 1];
      if (!last || last[1] !== c.count) sc.push([i + 1, c.count, 1]);
    });
    parts.push(fullbox("stsc", 0, 0, u32s([sc.length]), u32s(sc.flat())));
    parts.push(fullbox("stsz", 0, 0, u32s([0, t.sizes.length]), u32s(t.sizes)));
    parts.push(fullbox("stco", 0, 0, u32s([t.offs.length]), u32s(t.offs)));

    const minfParts = t.mif.filter(b => b.type !== "stbl").map(b => u8.slice(b.start, b.end));
    const mdiaParts = [mdhdP, ...t.mk2.filter(b => b.type !== "mdhd" && b.type !== "minf").map(b => u8.slice(b.start, b.end)),
      box("minf", ...minfParts, box("stbl", ...parts))];

    const trakParts = [tkhdP];
    if (t.delayMov > 0) {
      const mediaMov = Math.round(t.mediaDur / t.ts * mvTs);
      trakParts.push(box("edts", fullbox("elst", 0, 0, u32s([2]), u32s([t.delayMov]), i32s([-1]), u32s([0x00010000]),
        u32s([mediaMov]), i32s([0]), u32s([0x00010000]))));
    }
    trakParts.push(box("mdia", ...mdiaParts));
    for (const b of t.kids) if (!["tkhd", "mdia", "edts"].includes(b.type)) trakParts.push(u8.slice(b.start, b.end));
    return box("trak", ...trakParts);
  }

  function buildMoov() {
    const mvhdP = patch(mvhd, mvhd.hdr + 4 + (mvVer === 1 ? 20 : 12), mvVer === 1 ? 8 : 4, movDur);
    const others = mk.filter(b => !["mvhd", "trak", "mvex"].includes(b.type)).map(b => u8.slice(b.start, b.end));
    return box("moov", mvhdP, ...used.map(buildTrak), ...others);
  }

  const ftyp = box("ftyp", enc.encode("isom"), u32s([512]), enc.encode("isom"), enc.encode("iso2"), enc.encode("avc1"), enc.encode("mp41"));
  for (const t of used) t.offs = t.chunks.map(() => 0);
  const moovLen = buildMoov().length;
  let cur = ftyp.length + moovLen + 8;
  const mdatStart = cur;
  const idx = new Map(used.map(t => [t, 0]));
  for (const { t, chunk } of order) {
    if (!idx.has(t)) continue;
    const i = idx.get(t);
    t.offs[i] = cur; cur += chunk.len; idx.set(t, i + 1);
  }
  if (cur > 0xffffffff) return null;
  const moovBytes = buildMoov();
  const mdatHdr = new Uint8Array(8);
  new DataView(mdatHdr.buffer).setUint32(0, cur - mdatStart + 8);
  mdatHdr.set(enc.encode("mdat"), 4);

  const slices = [];
  for (const { t, chunk } of order) if (idx.has(t)) slices.push(blob.slice(chunk.pos, chunk.pos + chunk.len));
  return new Blob([ftyp, moovBytes, mdatHdr, ...slices], { type: "video/mp4" });
}
