// Run once to generate PWA icons: node generate-icons.js
// Creates icon-192.png and icon-512.png using only built-in Node modules

const zlib = require('zlib');
const fs   = require('fs');

function makeCRCTable() {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
}
const CRC_TABLE = makeCRCTable();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len  = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const tb   = Buffer.from(type);
  const crc  = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([len, tb, data, crc]);
}

function solidPNG(size, r, g, b) {
  const sig  = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = chunk('IHDR', Buffer.from([
    0,0,(size>>8)&0xff,size&0xff,
    0,0,(size>>8)&0xff,size&0xff,
    8, 2, 0, 0, 0
  ]));
  const row  = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) { row[1+x*3]=r; row[2+x*3]=g; row[3+x*3]=b; }
  const raw  = Buffer.concat(Array(size).fill(row));
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

// PABot blue (#0a84ff)
fs.writeFileSync('icon-192.png', solidPNG(192, 0x0a, 0x84, 0xff));
fs.writeFileSync('icon-512.png', solidPNG(512, 0x0a, 0x84, 0xff));
console.log('Done — icon-192.png and icon-512.png created.');
