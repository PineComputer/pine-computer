// A ZIP of library files, streamed as it is read: stored, not compressed (cuts and pictures
// already are), and ZIP64 throughout, so a season past 4 GiB opens like any other. Each
// file's checksum is read first, so every header carries its real size and CRC and the
// archive's length is known before the first byte goes out.
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";

export interface ZipEntry {
  /** The name inside the archive, folders separated by "/". */
  name: string;
  path: string;
  size: number;
}

const ZIP64 = 45; // the version that reads ZIP64
const UTF8 = 0x0800; // names are UTF-8

async function checksum(path: string): Promise<number> {
  let crc = 0;
  for await (const chunk of createReadStream(path)) crc = crc32(chunk as Buffer, crc);
  return crc >>> 0;
}

/** DOS time and date for now: the archive's entries carry the moment it was made. */
function dosTime(at = new Date()): { time: number; date: number } {
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

function localHeader(name: Buffer, crc: number, size: number, when: { time: number; date: number }): Buffer {
  const header = Buffer.alloc(30 + name.length + 20);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(ZIP64, 4);
  header.writeUInt16LE(UTF8, 6);
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt16LE(when.time, 10);
  header.writeUInt16LE(when.date, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(0xffffffff, 18); // sizes are in the ZIP64 field
  header.writeUInt32LE(0xffffffff, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(20, 28);
  name.copy(header, 30);
  const extra = 30 + name.length;
  header.writeUInt16LE(0x0001, extra);
  header.writeUInt16LE(16, extra + 2);
  header.writeBigUInt64LE(BigInt(size), extra + 4);
  header.writeBigUInt64LE(BigInt(size), extra + 12);
  return header;
}

function centralHeader(name: Buffer, crc: number, size: number, offset: number, when: { time: number; date: number }): Buffer {
  const header = Buffer.alloc(46 + name.length + 28);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(ZIP64, 4);
  header.writeUInt16LE(ZIP64, 6);
  header.writeUInt16LE(UTF8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(when.time, 12);
  header.writeUInt16LE(when.date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(0xffffffff, 20);
  header.writeUInt32LE(0xffffffff, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(28, 30);
  // comment, disk, internal and external attributes stay 0
  header.writeUInt32LE(0xffffffff, 42); // the offset is in the ZIP64 field
  name.copy(header, 46);
  const extra = 46 + name.length;
  header.writeUInt16LE(0x0001, extra);
  header.writeUInt16LE(24, extra + 2);
  header.writeBigUInt64LE(BigInt(size), extra + 4);
  header.writeBigUInt64LE(BigInt(size), extra + 12);
  header.writeBigUInt64LE(BigInt(offset), extra + 20);
  return header;
}

function end(entries: number, centralSize: number, centralOffset: number): Buffer {
  const record = Buffer.alloc(56 + 20 + 22);
  // ZIP64 end of central directory
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(ZIP64, 12);
  record.writeUInt16LE(ZIP64, 14);
  record.writeBigUInt64LE(BigInt(entries), 24);
  record.writeBigUInt64LE(BigInt(entries), 32);
  record.writeBigUInt64LE(BigInt(centralSize), 40);
  record.writeBigUInt64LE(BigInt(centralOffset), 48);
  // its locator
  record.writeUInt32LE(0x07064b50, 56);
  record.writeBigUInt64LE(BigInt(centralOffset + centralSize), 64);
  record.writeUInt32LE(1, 72);
  // the classic end record, pointing on to the ZIP64 one
  record.writeUInt32LE(0x06054b50, 76);
  record.writeUInt16LE(Math.min(entries, 0xffff), 84);
  record.writeUInt16LE(Math.min(entries, 0xffff), 86);
  record.writeUInt32LE(0xffffffff, 88);
  record.writeUInt32LE(0xffffffff, 92);
  return record;
}

/** The archive's length, from its entries alone. */
export function zipLength(entries: ZipEntry[]): number {
  let total = 98;
  for (const entry of entries) total += 30 + 20 + 46 + 28 + 2 * Buffer.byteLength(entry.name) + entry.size;
  return total;
}

/** The archive, chunk by chunk as the reader asks: each file's checksum is read, then its header and bytes go out. */
async function* chunks(entries: ZipEntry[]): AsyncGenerator<Uint8Array> {
  const when = dosTime();
  let offset = 0;
  const central: Buffer[] = [];
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const crc = await checksum(entry.path);
    const header = localHeader(name, crc, entry.size, when);
    yield header;
    central.push(centralHeader(name, crc, entry.size, offset, when));
    let written = 0;
    for await (const chunk of createReadStream(entry.path)) {
      written += (chunk as Buffer).length;
      yield chunk as Buffer;
    }
    if (written !== entry.size) throw new Error(`${entry.name} changed while it was being added.`);
    offset += header.length + entry.size;
  }
  const centralSize = central.reduce((sum, header) => sum + header.length, 0);
  yield* central;
  yield end(entries.length, centralSize, offset);
}

export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(chunks(entries), { objectMode: false })) as ReadableStream<Uint8Array>;
}
