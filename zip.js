/**
 * zip.js — KODOMO WORLD バックアップ用 最小ZIP読み書きモジュール
 *
 * classic script（<script src> で読み込む。import/export は使わない）。外部ライブラリ・
 * CDNは一切使わない。圧縮は行わず method=0（store／無圧縮）のみを扱う。中身が
 * JPEG/PNGなど既に圧縮済みのバイナリである前提のため、これで十分。
 *
 * ブラウザでは window.KWZip.create(entries) / window.KWZip.read(fileOrBlob) を
 * 主APIとして公開する。ファイル末尾の module.exports ガードで Node からも
 * 呼び出せる（ブラウザでは無害。window.KWZip が主APIであることに変わりはない）。
 *
 * ZIPフォーマットの要点（実装メモ）:
 *   - ローカルファイルヘッダ(PK\x03\x04, 30bytes固定) + ファイル名 + データ本体
 *   - セントラルディレクトリヘッダ(PK\x01\x02, 46bytes固定) + ファイル名
 *   - EOCD(PK\x05\x06, 22bytes固定)
 *   - 日時は 1980-01-01 00:00:00 固定（DOS時刻: 0 / DOS日付: 0x0021）
 *   - 汎用フラグは UTF-8 ビット(0x0800)を常に立てる
 *   - サイズは32bit（4GB未満前提、ZIP64は非対応）
 */
(function () {
  'use strict';

  // =====================================================================
  // CRC-32（テーブルは初回呼び出し時に生成してキャッシュ）
  // =====================================================================

  var crcTable = null;

  function getCrcTable() {
    if (crcTable) return crcTable;
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    crcTable = table;
    return table;
  }

  function crc32(bytes) {
    var table = getCrcTable();
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = (table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // =====================================================================
  // 定数
  // =====================================================================

  var SIG_LOCAL = 0x04034b50;
  var SIG_CENTRAL = 0x02014b50;
  var SIG_EOCD = 0x06054b50;

  var VERSION = 20;          // version needed to extract / made by
  var FLAG_UTF8 = 0x0800;    // 汎用フラグ: ファイル名がUTF-8である
  var METHOD_STORE = 0;

  var DOS_TIME_FIXED = 0;      // 00:00:00
  var DOS_DATE_FIXED = 0x0021; // 1980-01-01 (year=0, month=1, day=1)

  // =====================================================================
  // 入力データの正規化（Blob|Uint8Array|ArrayBuffer|string -> Uint8Array）
  // =====================================================================

  function isBlobLike(data) {
    return typeof Blob !== 'undefined' && data instanceof Blob;
  }

  async function toUint8Array(data) {
    if (data instanceof Uint8Array) {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    if (typeof data === 'string') {
      return new TextEncoder().encode(data);
    }
    if (isBlobLike(data)) {
      var ab = await data.arrayBuffer();
      return new Uint8Array(ab);
    }
    // ArrayBufferView 全般（TypedArray/DataView）のフォールバック
    if (data && typeof data.byteLength === 'number' && data.buffer instanceof ArrayBuffer) {
      return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    }
    throw new Error('KWZip: サポートされていないデータ形式です');
  }

  async function toUint8ArrayFromFile(fileOrBlob) {
    if (isBlobLike(fileOrBlob)) {
      var ab = await fileOrBlob.arrayBuffer();
      return new Uint8Array(ab);
    }
    if (fileOrBlob instanceof Uint8Array) {
      return fileOrBlob;
    }
    if (fileOrBlob instanceof ArrayBuffer) {
      return new Uint8Array(fileOrBlob);
    }
    throw new Error('KWZip: サポートされていない入力形式です');
  }

  // =====================================================================
  // 書き出し（create）
  // =====================================================================

  async function create(entries) {
    entries = entries || [];
    var textEncoder = new TextEncoder();

    var files = [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var bytes = await toUint8Array(entry.data);
      var nameBytes = textEncoder.encode(entry.name);
      files.push({
        name: entry.name,
        nameBytes: nameBytes,
        bytes: bytes,
        crc: crc32(bytes)
      });
    }

    var parts = [];      // Blob に渡すパーツ列（Uint8Array の並び）
    var localOffsets = [];
    var offset = 0;

    // ローカルファイルヘッダ + データ
    for (var fi = 0; fi < files.length; fi++) {
      var f = files[fi];
      var header = new Uint8Array(30);
      var dv = new DataView(header.buffer);
      dv.setUint32(0, SIG_LOCAL, true);
      dv.setUint16(4, VERSION, true);
      dv.setUint16(6, FLAG_UTF8, true);
      dv.setUint16(8, METHOD_STORE, true);
      dv.setUint16(10, DOS_TIME_FIXED, true);
      dv.setUint16(12, DOS_DATE_FIXED, true);
      dv.setUint32(14, f.crc, true);
      dv.setUint32(18, f.bytes.length, true); // compressed size
      dv.setUint32(22, f.bytes.length, true); // uncompressed size
      dv.setUint16(26, f.nameBytes.length, true);
      dv.setUint16(28, 0, true); // extra field length

      localOffsets.push(offset);
      parts.push(header, f.nameBytes, f.bytes);
      offset += 30 + f.nameBytes.length + f.bytes.length;
    }

    var centralOffset = offset;

    // セントラルディレクトリ
    for (var ci = 0; ci < files.length; ci++) {
      var cf = files[ci];
      var chdr = new Uint8Array(46);
      var cdv = new DataView(chdr.buffer);
      cdv.setUint32(0, SIG_CENTRAL, true);
      cdv.setUint16(4, VERSION, true); // version made by
      cdv.setUint16(6, VERSION, true); // version needed
      cdv.setUint16(8, FLAG_UTF8, true);
      cdv.setUint16(10, METHOD_STORE, true);
      cdv.setUint16(12, DOS_TIME_FIXED, true);
      cdv.setUint16(14, DOS_DATE_FIXED, true);
      cdv.setUint32(16, cf.crc, true);
      cdv.setUint32(20, cf.bytes.length, true);
      cdv.setUint32(24, cf.bytes.length, true);
      cdv.setUint16(28, cf.nameBytes.length, true);
      cdv.setUint16(30, 0, true); // extra field length
      cdv.setUint16(32, 0, true); // comment length
      cdv.setUint16(34, 0, true); // disk number start
      cdv.setUint16(36, 0, true); // internal file attributes
      cdv.setUint32(38, 0, true); // external file attributes
      cdv.setUint32(42, localOffsets[ci], true); // relative offset of local header

      parts.push(chdr, cf.nameBytes);
      offset += 46 + cf.nameBytes.length;
    }

    var centralSize = offset - centralOffset;

    // EOCD
    var eocd = new Uint8Array(22);
    var edv = new DataView(eocd.buffer);
    edv.setUint32(0, SIG_EOCD, true);
    edv.setUint16(4, 0, true);  // number of this disk
    edv.setUint16(6, 0, true);  // disk with start of central directory
    edv.setUint16(8, files.length, true);  // entries on this disk
    edv.setUint16(10, files.length, true); // total entries
    edv.setUint32(12, centralSize, true);
    edv.setUint32(16, centralOffset, true);
    edv.setUint16(20, 0, true); // comment length

    parts.push(eocd);

    return new Blob(parts, { type: 'application/zip' });
  }

  // =====================================================================
  // 読み込み（read）
  // =====================================================================

  function makeCorruptError() {
    var e = new Error('ZIPファイルとして読めません');
    e.kwZip = true;
    return e;
  }

  function makeCompressedError() {
    var e = new Error('この形式のZIPは読み込めません（圧縮されたファイルが含まれています）');
    e.kwZip = true;
    return e;
  }

  // 末尾から EOCD シグネチャ(PK\x05\x06)を探す。コメント長は最大65535なので
  // 探索範囲は末尾 22+65535 バイトで足りる（100MB級ファイルでも一瞬で終わる）。
  function findEOCD(buf) {
    var minLen = 22;
    if (buf.length < minLen) return -1;
    var searchWindow = Math.min(buf.length, minLen + 65535);
    var start = buf.length - minLen;
    var end = buf.length - searchWindow;
    if (end < 0) end = 0;
    for (var i = start; i >= end; i--) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4B && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
        return i;
      }
    }
    return -1;
  }

  async function read(fileOrBlob) {
    var buf = await toUint8ArrayFromFile(fileOrBlob);
    return parseZip(buf);
  }

  function parseZip(buf) {
    var eocdOffset = findEOCD(buf);
    if (eocdOffset < 0) {
      throw makeCorruptError();
    }

    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    var totalEntries, cdSize, cdOffset;
    try {
      totalEntries = dv.getUint16(eocdOffset + 10, true);
      cdSize = dv.getUint32(eocdOffset + 12, true);
      cdOffset = dv.getUint32(eocdOffset + 16, true);
    } catch (e) {
      throw makeCorruptError();
    }

    if (cdOffset + cdSize > buf.length || cdOffset > eocdOffset) {
      throw makeCorruptError();
    }

    var results = [];
    var pos = cdOffset;

    try {
      for (var i = 0; i < totalEntries; i++) {
        if (pos + 46 > buf.length) {
          throw makeCorruptError();
        }
        var sig = dv.getUint32(pos, true);
        if (sig !== SIG_CENTRAL) {
          throw makeCorruptError();
        }

        var method = dv.getUint16(pos + 10, true);
        var compSize = dv.getUint32(pos + 20, true);
        var nameLen = dv.getUint16(pos + 28, true);
        var extraLen = dv.getUint16(pos + 30, true);
        var commentLen = dv.getUint16(pos + 32, true);
        var localHeaderOffset = dv.getUint32(pos + 42, true);

        var nameStart = pos + 46;
        if (nameStart + nameLen > buf.length) {
          throw makeCorruptError();
        }
        var nameBytes = buf.subarray(nameStart, nameStart + nameLen);
        var name = new TextDecoder('utf-8').decode(nameBytes);

        pos = nameStart + nameLen + extraLen + commentLen;

        var isDirectory = name.length > 0 && name.charAt(name.length - 1) === '/';

        if (!isDirectory) {
          if (method !== METHOD_STORE) {
            throw makeCompressedError();
          }

          if (localHeaderOffset + 30 > buf.length) {
            throw makeCorruptError();
          }
          var lsig = dv.getUint32(localHeaderOffset, true);
          if (lsig !== SIG_LOCAL) {
            throw makeCorruptError();
          }
          var lNameLen = dv.getUint16(localHeaderOffset + 26, true);
          var lExtraLen = dv.getUint16(localHeaderOffset + 28, true);
          var dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
          var dataEnd = dataStart + compSize;
          if (dataStart < 0 || dataEnd > buf.length || dataEnd < dataStart) {
            throw makeCorruptError();
          }

          var dataBytes = buf.subarray(dataStart, dataEnd);
          results.push({
            name: name,
            blob: new Blob([dataBytes])
          });
        }
      }
    } catch (e) {
      if (e && e.kwZip) throw e;
      throw makeCorruptError();
    }

    return results;
  }

  // =====================================================================
  // 公開
  // =====================================================================

  var KWZip = {
    create: create,
    read: read
  };

  if (typeof window !== 'undefined') {
    window.KWZip = KWZip;
  }

  // Node からのテスト用（ブラウザでは無害。window.KWZip が主APIであることは変わらない）
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      create: create,
      read: read,
      crc32: crc32,
      KWZip: KWZip
    };
  }
})();
