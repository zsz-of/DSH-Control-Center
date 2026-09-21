/**
 * 极小的 ZIP 读写（只用 `node:zlib`，零第三方依赖）。
 *
 * **为什么自己写**：备份产物必须是用户能直接双击打开、也能被别的工具解开的标准 zip；
 * 而引入 `archiver`/`jszip` 就等于给插件加一条运行时依赖链（本项目的硬约束是零第三方依赖）。
 * ZIP 的「存储 + deflate」两种方式是稳定且极小的格式，写一个够用的实现比拉一个依赖更小风险。
 *
 * 写：每一条目先 deflate，压不小就退回存储（method 0），因此小文件与已压缩文件都不会变大。
 * 读：**以中央目录为准**（而不是顺着本地头往下走）——很多工具（资源管理器、7-zip）
 * 写 zip 时把大小放在数据描述符里、本地头里全是 0，只有中央目录是权威的。
 *
 * 不支持 ZIP64（单个条目/总大小 ≥ 4 GiB）：备份场景用不到，真遇到时明确报错而不是写坏包。
 * 本模块不 import cordis，可用 `node --test` 直接验证。
 *
 * @module dsh-control-center/zip
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
/** UTF-8 文件名标志位（通用目的位 11）。 */
const FLAG_UTF8 = 0x0800
/** 只用 bit 11 的 32 位无符号范围做运算。 */
const UINT32_MAX = 0xffffffff

/** CRC32 查表（多项式 0xEDB88320）。 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value
  }
  return table
})()

/** 计算 CRC32。 */
export function crc32(buffer) {
  let crc = -1
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ -1) >>> 0
}

/** 把 Date 编成 DOS 时间/日期两个 16 位值。 */
function dosDateTime(date) {
  const year = date.getFullYear() < 1980 ? 1980 : date.getFullYear()
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time: time & 0xffff, date: day & 0xffff }
}

/**
 * 打包一个 zip。
 *
 * @param entries - `[{ name, data, mtime? }]`；`name` 用 `/` 分隔，目录条目以 `/` 结尾。
 * @param options - `{ mtime }` 作为缺省修改时间。
 * @returns zip 文件的完整字节。
 */
export function createZip(entries, options = {}) {
  const fallback = options.mtime instanceof Date ? options.mtime : new Date()
  const chunks = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '')
    if (raw.length > UINT32_MAX) throw new Error(`条目 ${entry.name} 超过 4 GiB，zip 不支持`)
    const deflated = deflateRawSync(raw, { level: 6 })
    const useDeflate = deflated.length < raw.length
    const body = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0
    const checksum = crc32(raw)
    const stamp = dosDateTime(entry.mtime instanceof Date ? entry.mtime : fallback)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, name, body)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(CENTRAL_SIG, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(FLAG_UTF8, 8)
    header.writeUInt16LE(method, 10)
    header.writeUInt16LE(stamp.time, 12)
    header.writeUInt16LE(stamp.date, 14)
    header.writeUInt32LE(checksum, 16)
    header.writeUInt32LE(body.length, 20)
    header.writeUInt32LE(raw.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += local.length + name.length + body.length
  }

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD_SIG, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, centralBuffer, end])
}

/** 从尾部找 EOCD 记录的偏移。 */
function findEnd(buffer) {
  const limit = Math.max(0, buffer.length - 66000)
  for (let index = buffer.length - 22; index >= limit; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD_SIG) return index
  }
  return -1
}

/**
 * 解开一个 zip。
 *
 * @param buffer - zip 文件字节。
 * @returns `[{ name, data, directory, mtime }]`。
 */
export function readZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('不是一个 zip 文件（长度不足）')
  const end = findEnd(buffer)
  if (end < 0) throw new Error('不是一个 zip 文件（找不到中央目录结束记录）')
  const total = buffer.readUInt16LE(end + 10)
  let cursor = buffer.readUInt32LE(end + 16)
  const entries = []

  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIG) {
      throw new Error(`zip 中央目录第 ${index + 1} 条记录损坏`)
    }
    const method = buffer.readUInt16LE(cursor + 10)
    const time = buffer.readUInt16LE(cursor + 12)
    const date = buffer.readUInt16LE(cursor + 14)
    const checksum = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const plainSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    cursor += 46 + nameLength + extraLength + commentLength

    if (compressedSize === UINT32_MAX || plainSize === UINT32_MAX) {
      throw new Error(`条目 ${name} 使用了 ZIP64 扩展，本插件不支持`)
    }
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error(`条目 ${name} 的本地头损坏`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const body = buffer.subarray(start, start + compressedSize)
    let data
    if (method === 0) data = Buffer.from(body)
    else if (method === 8) {
      try {
        data = inflateRawSync(body)
      } catch (error) {
        throw new Error(`条目 ${name} 解压失败：${error?.message ?? String(error)}`)
      }
    } else throw new Error(`条目 ${name} 使用了不支持的压缩方式 ${method}`)

    if (data.length !== plainSize) throw new Error(`条目 ${name} 长度不符（期望 ${plainSize}，实际 ${data.length}）`)
    if (crc32(data) !== checksum) throw new Error(`条目 ${name} 校验失败（CRC32 不匹配）`)
    entries.push({
      name,
      data,
      directory: name.endsWith('/'),
      mtime: new Date(1980 + ((date >> 9) & 0x7f), ((date >> 5) & 0x0f) - 1, date & 0x1f, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2),
    })
  }
  return entries
}

/**
 * 校验一个相对路径是否可以安全地写进目标目录。
 *
 * 解压包是**不可信输入**：`../` 与绝对路径会造成目录穿越。这里只放行「不含空段、不含 `.`/`..`、
 * 不以分隔符开头、不含盘符冒号」的相对路径。
 *
 * @param name - zip 里的条目名。
 * @returns 是否安全。
 */
export function isSafeEntryName(name) {
  if (typeof name !== 'string' || name.length === 0) return false
  if (name.startsWith('/') || name.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(name)) return false
  if (name.includes('\0')) return false
  const parts = name.split(/[/\\]/)
  return parts.every((part) => part !== '..' && part !== '.' && part.length > 0)
}
