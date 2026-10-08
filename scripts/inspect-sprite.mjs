import sharp from 'sharp'
import { stat } from 'node:fs/promises'

const file = process.argv[2]
if (!file) throw new Error('Usage: node scripts/inspect-sprite.mjs path/to/candidate.png')
const metadata = await sharp(file).metadata()
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const cellWidth = info.width / 8
const frames = []
for (let frame = 0; frame < 8; frame++) {
  const start = Math.floor(frame * cellWidth)
  const end = Math.floor((frame + 1) * cellWidth)
  const width = end - start
  let left = width, right = 0, top = info.height, bottom = 0
  let edgePixels = 0
  for (let y = 0; y < info.height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * info.width + start + x) * 4 + 3] > 12) {
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
      if (x === 0 || x === width - 1) edgePixels++
    }
  }
  frames.push({ approximateSegment: frame + 1, width, left, right, top, bottom, edgePixels })
}
console.log(JSON.stringify({ width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha, bytes: (await stat(file)).size, requiredDimensions: '1024x128', actualCells: `${cellWidth}x${info.height}`, frames }, null, 2))
