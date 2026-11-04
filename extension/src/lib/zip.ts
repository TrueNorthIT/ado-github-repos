// A small zip reader for artifact zips (the Tests tab reads JUnit XML out of them). No dependency: the central directory is parsed
// here and deflated entries are inflated with the browser's DecompressionStream("deflate-raw"). Stored (0) and deflate (8) only,
// which is all GitHub's artifact zips use; encrypted entries are skipped. Sizes come from the central directory (local headers may
// defer them to a data descriptor), with the zip64 extra field read when a size or offset is 0xFFFFFFFF.

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflate; anything else cannot be read. */
  method: number;
  compressedSize: number;
  size: number;
  /** Offset of the entry's local file header. */
  offset: number;
  encrypted: boolean;
}

export class ZipError extends Error {}

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX32 = 0xffffffff;

const u64 = (v: DataView, at: number) => v.getUint32(at, true) + v.getUint32(at + 4, true) * 2 ** 32;

/** The entries in a zip's central directory (folders left out). Throws ZipError when it is not a zip or is damaged. */
export function listZipEntries(buf: Uint8Array): ZipEntry[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // The end of central directory record sits in the last 22 + 65535 bytes (after an optional comment).
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === EOCD) { end = i; break; }
  }
  if (end < 0) throw new ZipError("Not a zip file.");
  let count = v.getUint16(end + 10, true);
  let dirOffset = v.getUint32(end + 16, true);
  if ((count === 0xffff || dirOffset === MAX32) && end >= 20 && v.getUint32(end - 20, true) === EOCD64_LOCATOR) {
    const at = u64(v, end - 12);
    if (at + 56 > buf.length || v.getUint32(at, true) !== EOCD64) throw new ZipError("The zip64 directory is damaged.");
    count = u64(v, at + 32);
    dirOffset = u64(v, at + 48);
  }
  const out: ZipEntry[] = [];
  let p = dirOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || v.getUint32(p, true) !== CENTRAL) throw new ZipError("The zip directory is damaged.");
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    let compressedSize = v.getUint32(p + 20, true);
    let size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    let offset = v.getUint32(p + 42, true);
    const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
    // Bit 11: UTF-8 names. Others are usually ASCII; decoding them as UTF-8 is close enough for matching "*.xml".
    const name = new TextDecoder().decode(nameBytes);
    // zip64 extra field (id 1): the 0xFFFFFFFF fields follow in order size, compressed size, offset.
    for (let e = p + 46 + nameLen, stop = e + extraLen; e + 4 <= stop; ) {
      const id = v.getUint16(e, true);
      const len = v.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (size === MAX32) { size = u64(v, q); q += 8; }
        if (compressedSize === MAX32) { compressedSize = u64(v, q); q += 8; }
        if (offset === MAX32) offset = u64(v, q);
      }
      e += 4 + len;
    }
    if (!name.endsWith("/")) out.push({ name, method, compressedSize, size, offset, encrypted: (flags & 1) === 1 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The compressed bytes of an entry (after its local header). */
export function entryData(buf: Uint8Array, e: ZipEntry): Uint8Array {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (e.offset + 30 > buf.length || v.getUint32(e.offset, true) !== LOCAL) throw new ZipError(`${e.name}: the local header is damaged.`);
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  if (start + e.compressedSize > buf.length) throw new ZipError(`${e.name}: the zip is truncated.`);
  return buf.subarray(start, start + e.compressedSize);
}

/** Inflates raw deflate data, stopping with a ZipError once the output passes `limit` bytes (a zip bomb guard). */
export async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      void reader.cancel().catch(() => {});
      throw new ZipError("The file is larger than it claims.");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** An entry's contents. Throws ZipError for an encrypted entry, an unsupported method, or one that inflates past its stated size. */
export async function readZipEntry(buf: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  if (e.encrypted) throw new ZipError(`${e.name} is encrypted.`);
  const data = entryData(buf, e);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRaw(data, e.size);
  throw new ZipError(`${e.name} uses compression method ${e.method}.`);
}
