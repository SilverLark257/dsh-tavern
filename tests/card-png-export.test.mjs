// 人物卡 PNG 导出：浏览器侧把“选中的图片 + 当前 V3 文档”写成标准卡 PNG，
// 与服务端 pngWithTextChunks 的字节一致；导出前自检，旧 chara/ccv3 会被替换。
import assert from 'node:assert/strict'
import test from 'node:test'

import { cardPngWithCard } from '../tavern-plugin/lib/domain/card-png.js'
import { cardAssetSource, pngCardTextChunk, pngWithTextChunks } from '../tavern-plugin/lib/domain/card-assets.js'
import { stripPngTextChunks } from '../tavern-plugin/lib/domain/file-resources.js'

// 一张最小 PNG：签名 + 标记像素的 IDAT（内容无所谓，只用来区分图片）+ IEND。
function png(marker) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, 'ascii')
    data.copy(out, 8)
    return out
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IDAT', Buffer.from(marker)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const cardOf = bytes => cardAssetSource({ kind: 'png', fileB64: Buffer.from(bytes).toString('base64') }).card

test('导出 PNG：封面像素不变，角色数据能原样读回，且与服务端实现逐字节一致', () => {
  const cover = png('cover')
  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '浮华录',
      description: '云梦院的琉璃顶在午后阳光下折射出七彩光晕。',
      personality: '华丽、现实、讽刺',
      first_mes: '总导演，请下达指令。',
      tags: ['中文', '测试'],
      character_book: { name: '浮华录世界书', entries: [{ keys: ['云梦院'], content: '培养艺术与顶级 Omega 的温床。' }] }
    }
  }
  const text = JSON.stringify(card)
  const exported = cardPngWithCard(cover, text)
  const expected = pngWithTextChunks(cover, [pngCardTextChunk('chara', text), pngCardTextChunk('ccv3', text)])

  assert.deepEqual(Buffer.from(exported), expected, '浏览器实现必须与服务端实现写出一模一样的字节')
  assert.deepEqual(stripPngTextChunks(Buffer.from(exported)), cover, '图片像素不能被改动')
  assert.deepEqual(cardOf(exported), card, '导出的 PNG 要能原样读回角色数据')
})

test('导出 PNG：旧 chara/ccv3 被替换，不会把旧卡留在图片里', () => {
  const oldText = JSON.stringify({ spec: 'chara_card_v3', data: { name: '旧卡', description: 'OLD' } })
  const cover = pngWithTextChunks(png('cover'), [pngCardTextChunk('chara', oldText), pngCardTextChunk('ccv3', oldText)])
  const newText = JSON.stringify({ spec: 'chara_card_v3', data: { name: '浮华录', description: 'NEW' } })
  const exported = cardPngWithCard(cover, newText)

  assert.deepEqual(cardOf(exported), JSON.parse(newText))
  assert.equal(Buffer.from(exported).includes(Buffer.from('OLD')), false, '旧数据不能残留')
  assert.equal(Buffer.from(exported).toString('latin1').split('tEXt').length - 1, 2, '只保留两个文本块')
})

test('导出 PNG：拒绝非 PNG 和损坏的 PNG', () => {
  assert.throws(() => cardPngWithCard(Buffer.from('not a png'), '{}'), /PNG/)
  const broken = Buffer.from(png('x'))
  broken[broken.length - 5] = 0
  // 截断到 IEND 之前，模拟损坏文件。
  const truncated = broken.subarray(0, broken.length - 12)
  assert.throws(() => cardPngWithCard(truncated, '{}'), /损坏|结束块/)
})
