/**
 * dsh-group-chat — LLM 调用封装。
 *
 * 统一走宿主 llm 服务的 stream 接口（与 dsh-parallel-pool 相同的调用方式）：
 *  - completeText：单轮补全，BlockAssembler 聚合文本
 *  - extractJSON：把 LLM 输出中嵌的 JSON 解析出来（容错剥围栏/首尾括号）
 */

import { BlockAssembler } from '@deepseek-ai/dsh-llm'

/**
 * 一轮完整文本补全。
 * @param {object} llm - 宿主 llm 服务（必须有 stream）
 * @param {{provider: string, model: string}} route - 目标模型路由
 * @param {object} opts
 * @param {string} opts.system - 系统提示
 * @param {string} opts.userText - 用户消息正文
 * @param {number} opts.maxTokens - 生成长度上限
 * @param {string|undefined} opts.sessionId - 归属会话（计费/遥测）
 * @param {string} opts.purpose - 调用目的（遥测）
 * @param {AbortSignal|undefined} opts.signal - 中止信号
 * @returns {Promise<string>} 聚合后的纯文本（已 trim）
 */
export async function completeText(llm, route, { system, userText, maxTokens, sessionId, purpose, signal }) {
  if (!llm || typeof llm.stream !== 'function') {
    throw new Error('[dsh-group-chat] llm service unavailable')
  }
  const assembler = new BlockAssembler()
  const stream = llm.stream({
    provider: route.provider,
    model: route.model,
    system,
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: userText }],
    }],
    maxTokens,
    sessionId,
    purpose,
    signal,
  })
  for await (const chunk of stream) assembler.push(chunk)
  return assembler.blocks()
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim()
}

/**
 * 从 LLM 输出中提取首个 JSON 值（对象或数组）。
 * 容错：剥 ```json 围栏、取最外层首个 {/[ 到最后 }/] 的片段、JSON.parse 失败返回 null。
 * @param {string} text
 * @returns {unknown|null}
 */
export function extractJSON(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  const firstBracket = cleaned.indexOf('[')
  const lastBracket = cleaned.lastIndexOf(']')
  let start = -1
  let end = -1
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace
    end = lastBrace
  } else if (firstBracket !== -1) {
    start = firstBracket
    end = lastBracket
  }
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}
