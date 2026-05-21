// CSV 解析 + 反流事件检测的 WebWorker
// 算法与 scripts/preprocess.py 保持一致，但为浏览器性能做了简化（见 computeBaselines）

import type { Summary, RefluxEvent, Overview } from '../types';

/* ============== 通道布局（Sandhill ZAN-BR-44 标准） ============== */
const CHANNELS = [
  { key: 'Imp11', cm: 3 },
  { key: 'Imp12', cm: 5 },
  { key: 'Imp13', cm: 7 },
  { key: 'Imp14', cm: 9 },
  { key: 'Imp16', cm: 15 },
  { key: 'Imp17', cm: 17 },
] as const;
const PH_CHANNEL = 'pH8';
const SAMPLE_RATE = 50.0; // 文件中已统一上采样的频率

/* ============== 共识阈值 ============== */
const ACID_PH = 4.0;
const IMP_DROP_RATIO = 0.5;     // 50% 基线下降
const MIN_DURATION_S = 4.0;
const RETROGRADE_LAG_S = 0.1;
const EVENT_GAP_S = 5.0;

/* ============== 消息协议 ============== */
type WorkerMsg =
  | { type: 'parsing'; bytesRead: number; bytesTotal: number }
  | { type: 'analyzing'; stage: string }
  | { type: 'done'; payload: { summary: Summary; events: RefluxEvent[]; overview: Overview } }
  | { type: 'error'; message: string };

function post(msg: WorkerMsg) {
  (self as unknown as Worker).postMessage(msg);
}

/* ============== 主入口 ============== */
self.addEventListener('message', async (e: MessageEvent<{ file: File }>) => {
  try {
    const { file } = e.data;
    post({ type: 'parsing', bytesRead: 0, bytesTotal: file.size });

    const parsed = await parseSandhillCsv(file);
    post({ type: 'analyzing', stage: '计算阻抗基线' });
    const baselines = computeBaselines(parsed.imp);

    post({ type: 'analyzing', stage: '检测反流事件' });
    const drops = detectImpedanceDrops(parsed.imp, baselines);
    const events = detectRefluxEvents(parsed, baselines, drops);

    post({ type: 'analyzing', stage: '计算诊断指标' });
    const summary = computeSummary(parsed, events, baselines);

    post({ type: 'analyzing', stage: '生成总览图' });
    const overview = buildOverview(parsed, baselines);

    post({ type: 'done', payload: { summary, events, overview } });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});

/* ============== CSV 解析（流式） ============== */
interface ParsedData {
  ph: Float32Array;
  imp: Record<string, Float32Array>;
  n: number;
}

async function parseSandhillCsv(file: File): Promise<ParsedData> {
  // 用 ReadableStream + TextDecoder 流式读取，避免 500MB 全部进内存
  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder('latin1'); // 文件头部为 GBK，但我们跳过；数据部分为 ASCII
  let bytesRead = 0;
  let buffer = '';
  let headerDone = false;
  let columns: string[] = [];
  let phIdx = -1;
  const impIdx: Record<string, number> = {};

  const ph: number[] = [];
  const imp: Record<string, number[]> = {};
  for (const c of CHANNELS) imp[c.key] = [];

  let dataLineIndex = 0;
  let lastProgressBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    buffer += decoder.decode(value, { stream: true });

    // 处理完整行
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const rawLine = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      // 去掉 CR (CRLF)
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

      if (!headerDone) {
        // 头部 6 行；第 7 行是列名（Sample number, pH8, Imp11, Base24, ...）
        if (line.startsWith('Sample number')) {
          columns = line.split(',').map((s) => s.trim());
          phIdx = columns.indexOf(PH_CHANNEL);
          for (const c of CHANNELS) impIdx[c.key] = columns.indexOf(c.key);
          headerDone = true;
          if (phIdx < 0) throw new Error('未在 CSV 中找到 pH8 列。请确认是 Sandhill 13 通道格式。');
        }
        continue;
      }

      // 数据行
      const parts = line.split(',');
      if (parts.length < columns.length) continue;
      ph.push(parseFloat(parts[phIdx]));
      for (const c of CHANNELS) imp[c.key].push(parseFloat(parts[impIdx[c.key]]));
      dataLineIndex++;
    }

    // 每 5 MB 报告一次进度
    if (bytesRead - lastProgressBytes > 5 * 1024 * 1024) {
      post({ type: 'parsing', bytesRead, bytesTotal: file.size });
      lastProgressBytes = bytesRead;
    }
  }
  post({ type: 'parsing', bytesRead: file.size, bytesTotal: file.size });

  if (ph.length === 0) throw new Error('CSV 未解析到数据行。');

  const phArr = new Float32Array(ph);
  const impArr: Record<string, Float32Array> = {};
  for (const c of CHANNELS) impArr[c.key] = new Float32Array(imp[c.key]);

  return { ph: phArr, imp: impArr, n: phArr.length };
}

/* ============== 阻抗基线（每个通道一个粗粒度滑动 0.85 分位数） ============== */
// 性能简化：将整段数据按 30 分钟分段，每段取 0.85 分位数作为该段的基线，再线性插值
// 与 preprocess.py 的 5-min 滑动 0.85 分位数效果近似但快几个量级
function computeBaselines(imp: Record<string, Float32Array>): Record<string, Float32Array> {
  const segmentS = 30 * 60; // 30 分钟
  const segmentN = Math.floor(segmentS * SAMPLE_RATE);
  const result: Record<string, Float32Array> = {};

  for (const c of CHANNELS) {
    const data = imp[c.key];
    const n = data.length;
    const baseline = new Float32Array(n);
    // 计算每段的 0.85 分位数
    const anchors: { pos: number; val: number }[] = [];
    for (let segStart = 0; segStart < n; segStart += segmentN) {
      const segEnd = Math.min(n, segStart + segmentN);
      const arr = Array.from(data.subarray(segStart, segEnd));
      arr.sort((a, b) => a - b);
      const q85 = arr[Math.floor(arr.length * 0.85)] || 1;
      anchors.push({ pos: (segStart + segEnd) / 2, val: q85 });
    }
    // 端点扩展
    if (anchors.length > 0) {
      anchors.unshift({ pos: 0, val: anchors[0].val });
      anchors.push({ pos: n, val: anchors[anchors.length - 1].val });
    }
    // 线性插值填充每个样本
    let ai = 0;
    for (let i = 0; i < n; i++) {
      while (ai < anchors.length - 1 && anchors[ai + 1].pos < i) ai++;
      const a = anchors[ai];
      const b = anchors[Math.min(ai + 1, anchors.length - 1)];
      if (a === b) baseline[i] = a.val;
      else {
        const t = (i - a.pos) / (b.pos - a.pos);
        baseline[i] = a.val + (b.val - a.val) * t;
      }
    }
    result[c.key] = baseline;
  }
  return result;
}

function detectImpedanceDrops(
  imp: Record<string, Float32Array>,
  baselines: Record<string, Float32Array>,
): Record<string, Uint8Array> {
  const drops: Record<string, Uint8Array> = {};
  for (const c of CHANNELS) {
    const data = imp[c.key];
    const base = baselines[c.key];
    const mask = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      mask[i] = data[i] < base[i] * IMP_DROP_RATIO ? 1 : 0;
    }
    drops[c.key] = mask;
  }
  return drops;
}

/* ============== 找 bool 数组里的连续段 ============== */
function findRuns(mask: Uint8Array): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && start < 0) start = i;
    else if (!mask[i] && start >= 0) {
      runs.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, mask.length]);
  return runs;
}

/* ============== 反流事件检测（核心） ============== */
function detectRefluxEvents(
  parsed: ParsedData,
  baselines: Record<string, Float32Array>,
  drops: Record<string, Uint8Array>,
): RefluxEvent[] {
  const distalRuns = findRuns(drops['Imp11']);
  const minSamples = Math.floor(MIN_DURATION_S * SAMPLE_RATE);
  const lagSamples = Math.floor(RETROGRADE_LAG_S * SAMPLE_RATE);

  const events: RefluxEvent[] = [];
  const ph = parsed.ph;

  for (const [dStart, dEnd] of distalRuns) {
    if (dEnd - dStart < minSamples) continue;
    const winLo = Math.max(0, dStart - Math.floor(2 * SAMPLE_RATE));
    const winHi = Math.min(ph.length, dEnd + Math.floor(2 * SAMPLE_RATE));

    // 每个通道在事件窗口内的"首次下降"位置
    const channelStarts: Record<string, number | null> = {};
    for (const c of CHANNELS) {
      const mask = drops[c.key];
      let first: number | null = null;
      for (let i = winLo; i < winHi; i++) {
        if (mask[i]) { first = i; break; }
      }
      channelStarts[c.key] = first;
    }

    const s11 = channelStarts['Imp11'];
    const s12 = channelStarts['Imp12'];
    if (s11 == null || s12 == null) continue;
    if (s12 < s11 - lagSamples) continue; // Imp12 显著早于 Imp11 → 顺向（吞咽）

    // 确定 proximal extent（自下而上，必须保持逆向传播）
    let proxKey: string = 'Imp12';
    let proxCm = 5;
    let prevStart = s12;
    for (let i = 2; i < CHANNELS.length; i++) {
      const c = CHANNELS[i];
      const s = channelStarts[c.key];
      if (s == null || s < prevStart - lagSamples) break;
      proxKey = c.key;
      proxCm = c.cm;
      prevStart = s;
    }

    // 事件结束：所有涉及通道阻抗回升到基线 80%
    let endIdx = dEnd;
    for (const c of CHANNELS) {
      const s = channelStarts[c.key];
      if (s == null) continue;
      const data = parsed.imp[c.key];
      const base = baselines[c.key];
      const thr80 = (i: number) => base[i] * 0.8;
      let rec = data.length;
      for (let i = s; i < data.length; i++) {
        if (data[i] > thr80(i)) { rec = i; break; }
      }
      endIdx = Math.max(endIdx, rec);
    }
    if (endIdx - s11 < minSamples) continue;

    // pH 谷值（事件 + 之后 30s）
    const phWinEnd = Math.min(ph.length, endIdx + Math.floor(30 * SAMPLE_RATE));
    let phNadir = Infinity;
    let phAtStart = ph[s11];
    for (let i = s11; i < phWinEnd; i++) {
      if (ph[i] < phNadir) phNadir = ph[i];
    }

    let type: RefluxEvent['type'];
    if (phNadir < ACID_PH) type = 'acid';
    else if (phNadir > 7 && phAtStart > 7) type = 'weakly_alkaline';
    else if (phNadir < 7) type = 'weakly_acidic';
    else type = 'non_acid_bolus';

    const channelsInvolved = CHANNELS.filter((c) => channelStarts[c.key] != null).length;
    const durationS = (endIdx - s11) / SAMPLE_RATE;

    // 严重度评分
    const scoreDur = Math.min(40, (durationS / 60) * 40);
    const scoreProx = ((proxCm - 3) / 14) * 30;
    const scorePh = Math.max(0, ((7 - phNadir) / 7) * 30);
    const severityScore = Math.round((scoreDur + scoreProx + scorePh) * 10) / 10;
    const severity: RefluxEvent['severity'] =
      severityScore < 25 ? 'mild' : severityScore < 55 ? 'moderate' : 'severe';

    const notes: string[] = [];
    if (durationS > 300) notes.push('超长反流（>5 分钟），提示食管清除能力受损');
    if (proxCm >= 15) notes.push('反流近端到达 ≥15cm，已达咽喉部');
    if (type === 'acid' && phNadir < 2) notes.push('强酸性反流（pH<2），对食管粘膜损伤显著');

    events.push({
      id: events.length,
      start_s: round(s11 / SAMPLE_RATE, 2),
      end_s: round(endIdx / SAMPLE_RATE, 2),
      duration_s: round(durationS, 2),
      type,
      ph_nadir: round(phNadir, 2),
      ph_at_start: round(phAtStart, 2),
      proximal_extent_cm: proxCm,
      proximal_channel: proxKey,
      distal_channels_involved: channelsInvolved,
      severity,
      severity_score: severityScore,
      is_long: durationS > 300,
      notes,
    });
  }

  // 合并相邻事件（间隙 <5s）
  const merged: RefluxEvent[] = [];
  for (const ev of events) {
    const prev = merged[merged.length - 1];
    if (prev && ev.start_s - prev.end_s < EVENT_GAP_S) {
      prev.end_s = ev.end_s;
      prev.duration_s = round(prev.end_s - prev.start_s, 2);
      prev.ph_nadir = Math.min(prev.ph_nadir, ev.ph_nadir);
      prev.proximal_extent_cm = Math.max(prev.proximal_extent_cm, ev.proximal_extent_cm);
      if (ev.proximal_extent_cm > prev.proximal_extent_cm) prev.proximal_channel = ev.proximal_channel;
      prev.distal_channels_involved = Math.max(prev.distal_channels_involved, ev.distal_channels_involved);
      prev.is_long = prev.duration_s > 300;
      if (prev.ph_nadir < ACID_PH) prev.type = 'acid';
      const d = prev.duration_s;
      const sd = Math.min(40, (d / 60) * 40);
      const sp = ((prev.proximal_extent_cm - 3) / 14) * 30;
      const sph = Math.max(0, ((7 - prev.ph_nadir) / 7) * 30);
      prev.severity_score = Math.round((sd + sp + sph) * 10) / 10;
      prev.severity = prev.severity_score < 25 ? 'mild' : prev.severity_score < 55 ? 'moderate' : 'severe';
    } else {
      merged.push({ ...ev });
    }
  }
  merged.forEach((e, i) => (e.id = i));
  return merged;
}

function computeSummary(parsed: ParsedData, events: RefluxEvent[], _baselines: Record<string, Float32Array>): Summary {
  const ph = parsed.ph;
  const n = parsed.n;
  const totalS = n / SAMPLE_RATE;
  let acidSamples = 0;
  for (let i = 0; i < n; i++) if (ph[i] < ACID_PH) acidSamples++;
  const aet = (acidSamples / n) * 100;

  // pH<4 持续 ≥5s 的酸暴露段
  const acidMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) acidMask[i] = ph[i] < ACID_PH ? 1 : 0;
  const acidRuns = findRuns(acidMask).filter((r) => r[1] - r[0] >= 5 * SAMPLE_RATE);
  const longest = acidRuns.length ? Math.max(...acidRuns.map((r) => r[1] - r[0])) / SAMPLE_RATE : 0;
  const longEpisodes = acidRuns.filter((r) => (r[1] - r[0]) / SAMPLE_RATE > 300).length;

  // MNBI: 找标准差最小的 10 分钟窗口的中位数
  const mnbi: Record<string, number> = {};
  for (const c of CHANNELS) {
    const data = parsed.imp[c.key];
    const win = Math.floor(10 * 60 * SAMPLE_RATE);
    const stride = Math.floor(5 * 60 * SAMPLE_RATE);
    let bestStd = Infinity;
    let bestMed = data[0] ?? 0;
    if (data.length > win) {
      for (let s = 0; s + win < data.length; s += stride) {
        let sum = 0;
        for (let i = s; i < s + win; i++) sum += data[i];
        const mean = sum / win;
        let v = 0;
        for (let i = s; i < s + win; i++) v += (data[i] - mean) ** 2;
        const std = Math.sqrt(v / win);
        if (std < bestStd) {
          bestStd = std;
          const seg = Array.from(data.subarray(s, s + win)).sort((a, b) => a - b);
          bestMed = seg[Math.floor(seg.length / 2)];
        }
      }
    } else {
      const seg = Array.from(data).sort((a, b) => a - b);
      bestMed = seg[Math.floor(seg.length / 2)];
    }
    mnbi[c.key] = bestMed;
  }
  const mnbiDistal = (mnbi['Imp11'] + mnbi['Imp12']) / 2;

  let diagnosis: string;
  let diagnosisLevel: Summary['diagnosis_level'];
  if (aet > 6) {
    diagnosis = '病理性反流（明确 GERD）';
    diagnosisLevel = 'conclusive';
  } else if (aet < 4) {
    diagnosis = 'AET 正常范围';
    diagnosisLevel = 'normal';
  } else {
    diagnosis = '灰区（不确定）—— 需结合症状关联、MNBI 等辅助证据综合判断';
    diagnosisLevel = 'inconclusive';
  }

  const supportive: string[] = [];
  if (events.length > 80) supportive.push(`24 小时反流事件 ${events.length} 次（>80/天）`);
  if (mnbiDistal < 1500) supportive.push(`远端 MNBI ${Math.round(mnbiDistal)}Ω (<1500Ω，提示粘膜屏障受损)`);
  if (longEpisodes > 0) supportive.push(`${longEpisodes} 次超长酸反流（>5 分钟）`);

  return {
    recording_duration_h: round(totalS / 3600, 2),
    sample_rate_hz: SAMPLE_RATE,
    aet_percent: round(aet, 2),
    aet_threshold_pathological: 6.0,
    aet_threshold_normal: 4.0,
    diagnosis,
    diagnosis_level: diagnosisLevel,
    total_reflux_episodes: events.length,
    acid_episodes: events.filter((e) => e.type === 'acid').length,
    weakly_acidic_episodes: events.filter((e) => e.type === 'weakly_acidic').length,
    non_acid_episodes: events.filter((e) => e.type === 'non_acid_bolus' || e.type === 'weakly_alkaline').length,
    longest_acid_episode_s: round(longest, 1),
    long_episodes_over_5min: longEpisodes,
    mnbi_per_channel: Object.fromEntries(Object.entries(mnbi).map(([k, v]) => [k, Math.round(v)])),
    mnbi_distal_mean: Math.round(mnbiDistal),
    mnbi_threshold_abnormal: 1500,
    supportive_evidence: supportive,
    channel_positions_cm: Object.fromEntries(CHANNELS.map((c) => [c.key, c.cm])),
  };
}

/* ============== 1Hz 总览（用于全程时间序列图） ============== */
function buildOverview(parsed: ParsedData, baselines: Record<string, Float32Array>): Overview {
  const factor = Math.floor(SAMPLE_RATE / 1.0); // 50 → 1Hz
  const nOut = Math.floor(parsed.n / factor);
  const t = new Array(nOut);
  for (let i = 0; i < nOut; i++) t[i] = i;
  const pH = new Array(nOut);
  const pH_min = new Array(nOut);
  for (let i = 0; i < nOut; i++) {
    let sum = 0, minV = Infinity;
    for (let j = 0; j < factor; j++) {
      const v = parsed.ph[i * factor + j];
      sum += v;
      if (v < minV) minV = v;
    }
    pH[i] = round(sum / factor, 2);
    pH_min[i] = round(minV, 2);
  }
  const result: Overview = {
    sample_rate_hz: 1.0,
    n_samples: nOut,
    t,
    pH,
    pH_min,
    Imp11: [], Imp12: [], Imp13: [], Imp14: [], Imp16: [], Imp17: [],
  };
  for (const c of CHANNELS) {
    const data = parsed.imp[c.key];
    const base = baselines[c.key];
    const arr = new Array(nOut);
    for (let i = 0; i < nOut; i++) {
      let sum = 0;
      for (let j = 0; j < factor; j++) {
        const v = data[i * factor + j];
        const b = base[i * factor + j];
        sum += b > 0 ? v / b : 1;
      }
      arr[i] = round((sum / factor) * 100, 1);
    }
    (result as unknown as Record<string, number[]>)[c.key] = arr;
  }
  return result;
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export {}; // 模块标记
