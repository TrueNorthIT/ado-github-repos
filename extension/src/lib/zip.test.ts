import { describe, it, expect } from "vitest";
import { inflateRaw, listZipEntries, readZipEntry, ZipError } from "./zip";
import { buildZip, crc32, deflateRaw } from "./zipWrite";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("zip reader", async () => {
  const xml = enc.encode("<testsuite name='a'>" + "<testcase name='x'/>".repeat(200) + "</testsuite>");
  const zip = buildZip([
    { name: "reports/", data: new Uint8Array() },
    { name: "reports/junit.xml", data: xml, deflated: await deflateRaw(xml) },
    { name: "readme.txt", data: enc.encode("hello") },
    { name: "ünïcode.xml", data: enc.encode("<x/>") },
  ]);

  it("lists files from the central directory, leaving folders out", () => {
    const es = listZipEntries(zip);
    expect(es.map((e) => [e.name, e.method, e.size])).toEqual([["reports/junit.xml", 8, xml.length], ["readme.txt", 0, 5], ["ünïcode.xml", 0, 4]]);
    expect(es[0].compressedSize).toBeLessThan(xml.length);
  });

  it("reads stored and deflated entries", async () => {
    const [j, r] = listZipEntries(zip);
    expect(dec.decode(await readZipEntry(zip, j))).toBe(dec.decode(xml));
    expect(dec.decode(await readZipEntry(zip, r))).toBe("hello");
  });

  it("finds the directory past a trailing comment", () => {
    const withComment = new Uint8Array(zip.length + 5);
    withComment.set(zip);
    withComment.set(enc.encode("hi!!!"), zip.length);
    new DataView(withComment.buffer).setUint16(zip.length - 2, 5, true);
    expect(listZipEntries(withComment)).toHaveLength(3);
  });

  it("refuses what is not a zip, and a truncated one", () => {
    expect(() => listZipEntries(enc.encode("not a zip at all, sorry about that"))).toThrow(ZipError);
    expect(() => listZipEntries(zip.slice(0, 40))).toThrow(ZipError);
  });

  it("refuses an entry that inflates past its stated size (zip bomb guard)", async () => {
    const big = new Uint8Array(1_000_000);
    const packed = await deflateRaw(big);
    await expect(inflateRaw(packed, 1000)).rejects.toThrow(ZipError);
    const lying = buildZip([{ name: "a.xml", data: big.subarray(0, 10), deflated: packed }]);
    await expect(readZipEntry(lying, listZipEntries(lying)[0])).rejects.toThrow(/larger than it claims/);
  });

  it("refuses encrypted entries and unknown methods", async () => {
    const z = buildZip([{ name: "a.xml", data: enc.encode("x") }]);
    const [e] = listZipEntries(z);
    await expect(readZipEntry(z, { ...e, encrypted: true })).rejects.toThrow(/encrypted/);
    await expect(readZipEntry(z, { ...e, method: 12 })).rejects.toThrow(/method 12/);
  });

  it("reads zip64 sizes from the extra field", () => {
    // A central directory entry whose sizes are 0xFFFFFFFF, with a zip64 extra field carrying the real ones.
    const name = enc.encode("big.xml");
    const local = new Uint8Array(30 + name.length + 3);
    new DataView(local.buffer).setUint32(0, 0x04034b50, true);
    new DataView(local.buffer).setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(enc.encode("abc"), 30 + name.length);
    const cen = new Uint8Array(46 + name.length + 20);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, 0xffffffff, true);
    cv.setUint32(24, 0xffffffff, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 20, true);
    cen.set(name, 46);
    cv.setUint16(46 + name.length, 1, true);
    cv.setUint16(48 + name.length, 16, true);
    cv.setUint32(50 + name.length, 3, true); // size
    cv.setUint32(58 + name.length, 3, true); // compressed size
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, 1, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, cen.length, true);
    ev.setUint32(16, local.length, true);
    const z = new Uint8Array([...local, ...cen, ...end]);
    expect(listZipEntries(z)[0]).toMatchObject({ name: "big.xml", size: 3, compressedSize: 3, offset: 0 });
  });

  it("computes the standard CRC-32", () => {
    expect(crc32(enc.encode("123456789")).toString(16)).toBe("cbf43926");
  });
});
