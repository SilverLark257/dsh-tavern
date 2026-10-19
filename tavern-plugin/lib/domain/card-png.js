// Browser-safe PNG character card writer. Shared with the browser bundle
// (@include-domain): keep top-level names specific.
//
// A card PNG is the cover's pixels plus a `chara` and a `ccv3` tEXt chunk.
// This module is deliberately pure: it reads no files, uses no Node APIs and
// changes no Tavern state. It mirrors tavern-plugin/lib/domain/card-assets.js
// (pngCardTextChunk + pngWithTextChunks) so the browser and the host write the
// same bytes.

const cardPngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const cardPngTextTypes = ['tEXt', 'zTXt', 'iTXt']
const cardPngCrcTable = (function () {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function cardPngBytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (value && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new TypeError('PNG 数据必须是 Uint8Array 或 ArrayBuffer')
}

function cardPngAscii(value) {
  const text = String(value)
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index) & 0xff
  return bytes
}

function cardPngString(bytes, offset, length) {
  let text = ''
  for (let index = 0; index < length; index++) text += String.fromCharCode(bytes[offset + index])
  return text
}

function cardPngWriteUint32(target, offset, value) {
  const number = Number(value) >>> 0
  target[offset] = (number >>> 24) & 0xff
  target[offset + 1] = (number >>> 16) & 0xff
  target[offset + 2] = (number >>> 8) & 0xff
  target[offset + 3] = number & 0xff
}

function cardPngReadUint32(source, offset) {
  return ((source[offset] << 24) | (source[offset + 1] << 16) | (source[offset + 2] << 8) | source[offset + 3]) >>> 0
}

function cardPngCrc32(bytes) {
  let value = 0xffffffff
  for (let index = 0; index < bytes.length; index++) value = cardPngCrcTable[(value ^ bytes[index]) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function cardPngBase64(text) {
  const bytes = new TextEncoder().encode(String(text))
  let binary = ''
  // Chunked so a large card does not overflow the argument limit of apply().
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)))
  }
  if (typeof btoa !== 'function') throw new Error('当前环境不支持 base64 编码')
  return btoa(binary)
}

function cardPngTextChunk(keyword, text) {
  const encoded = cardPngAscii(cardPngBase64(text))
  const name = cardPngAscii(keyword)
  const data = new Uint8Array(name.length + 1 + encoded.length)
  data.set(name, 0)
  data[name.length] = 0
  data.set(encoded, name.length + 1)
  const chunk = new Uint8Array(12 + data.length)
  cardPngWriteUint32(chunk, 0, data.length)
  chunk.set(cardPngAscii('tEXt'), 4)
  chunk.set(data, 8)
  cardPngWriteUint32(chunk, 8 + data.length, cardPngCrc32(chunk.subarray(4, 8 + data.length)))
  return chunk
}

function cardPngConcat(parts) {
  let length = 0
  for (const part of parts) length += part.length
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) { output.set(part, offset); offset += part.length }
  return output
}

/**
 * `png`'s pixels with its own text chunks dropped and the card written as
 * `chara` (legacy readers) and `ccv3` (SillyTavern's first choice).
 * @param {Uint8Array|ArrayBuffer} png
 * @param {string} cardText JSON text of the standard card document
 * @returns {Uint8Array}
 */
function cardPngWithCard(png, cardText) {
  const source = cardPngBytes(png)
  if (source.length <= 8) throw new Error('卡面不是有效的 PNG 图片')
  for (let index = 0; index < cardPngSignature.length; index++) {
    if (source[index] !== cardPngSignature[index]) throw new Error('卡面不是有效的 PNG 图片')
  }
  const text = String(cardText)
  const chunks = [cardPngTextChunk('chara', text), cardPngTextChunk('ccv3', text)]
  const parts = [source.subarray(0, 8)]
  let offset = 8
  while (offset + 12 <= source.length) {
    const length = cardPngReadUint32(source, offset)
    const type = cardPngString(source, offset + 4, 4)
    const end = offset + 12 + length
    if (end > source.length) throw new Error('卡面 PNG 数据损坏')
    if (type === 'IEND') {
      parts.push(chunks[0], chunks[1], source.subarray(offset, end))
      return cardPngConcat(parts)
    }
    if (!cardPngTextTypes.includes(type)) parts.push(source.subarray(offset, end))
    offset = end
  }
  throw new Error('卡面 PNG 缺少结束块')
}

export { cardPngWithCard }
