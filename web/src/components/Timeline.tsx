import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import type { Overview, RefluxEvent, ViewMode } from '../types';
import { TYPE_COLOR, TYPE_LABEL, fmtTime, fmtDuration } from '../explain';
import { RangeSlider } from './RangeSlider';

interface Props {
  overview: Overview;
  events: RefluxEvent[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  view: ViewMode;
  xRange: { min: number; max: number } | null;
  onXRangeChange: (range: { min: number; max: number } | null) => void;
  onResetZoom: () => void;
  totalDuration: number;
}

interface ChannelDef {
  key: keyof Overview;
  label: string;
  color: string;
  cm: number;
}

const CHANNELS: ChannelDef[] = [
  { key: 'Imp11', label: '3 cm', color: '#0284c7', cm: 3 },
  { key: 'Imp12', label: '5 cm', color: '#0369a1', cm: 5 },
  { key: 'Imp13', label: '7 cm', color: '#0e7490', cm: 7 },
  { key: 'Imp14', label: '9 cm', color: '#0d9488', cm: 9 },
  { key: 'Imp16', label: '15 cm', color: '#7c3aed', cm: 15 },
  { key: 'Imp17', label: '17 cm', color: '#5b21b6', cm: 17 },
];

const EVENT_TRACK_H = 50;
const TRACK_OVERLAY_PAD = 4;
const MIN_RANGE_S = 30;  // 最小缩放窗口 30 秒

export function Timeline({
  overview, events, selectedId, onSelect, view,
  xRange, onXRangeChange, onResetZoom, totalDuration,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const xRangeRef = useRef(xRange); // 给事件回调用最新值
  xRangeRef.current = xRange;

  const [visibleImp, setVisibleImp] = useState<Set<string>>(() => new Set());

  // 选中事件时只自动开启「反流到达的最高通道」（最具说服力的一条），其他通道隐藏避免视觉拥挤；
  // 用户可手动通过下方按钮叠加显示其他通道；重置时全部隐藏
  useEffect(() => {
    if (selectedId == null) {
      setVisibleImp(new Set());
      return;
    }
    const ev = events.find((e) => e.id === selectedId);
    if (!ev) return;
    const proximal = CHANNELS.find((c) => c.cm === ev.proximal_extent_cm);
    setVisibleImp(new Set(proximal ? [proximal.key as string] : []));
  }, [selectedId, events]);

  // 当前可视时间范围（用于注解逻辑）
  const visMin = xRange?.min ?? 0;
  const visMax = xRange?.max ?? totalDuration;
  const visRange = visMax - visMin;

  // 是否在"事件级缩放"
  const zoomedToEvent = selectedId != null && xRange != null && visRange < 600;
  const focusedEvent = zoomedToEvent ? events.find((e) => e.id === selectedId) : null;

  const series = useMemo(() => {
    return [
      overview.t,
      overview.pH,
      ...CHANNELS.map((c) => overview[c.key] as number[]),
    ] as uPlot.AlignedData;
  }, [overview]);

  useEffect(() => {
    if (!containerRef.current) return;
    const w = containerRef.current.clientWidth;
    const h = 420;

    const opts: uPlot.Options = {
      width: w,
      height: h,
      legend: { show: false },
      padding: [EVENT_TRACK_H + 14, 12, 12, 12],
      cursor: {
        drag: { x: false, y: false },
        focus: { prox: 16 },
      },
      scales: {
        x: { time: false, min: visMin, max: visMax },
        ph: { range: [0, 9] },
        imp: { range: [0, 130] },
      },
      axes: [
        {
          values: (_u, splits) => splits.map((s) => fmtTime(s as number)),
          space: 90,
          stroke: '#64748b',
          font: '11px system-ui',
          grid: { stroke: '#e2e8f0', width: 1 },
        },
        {
          scale: 'ph',
          label: 'pH (酸碱度)',
          labelSize: 14,
          labelFont: '12px system-ui',
          size: 55,
          stroke: '#0f172a',
          font: '11px system-ui',
          values: (_u, splits) => splits.map((s) => String(s)),
          grid: { stroke: '#f1f5f9', width: 1 },
        },
        {
          scale: 'imp',
          label: '阻抗 (% 基线)',
          labelSize: 14,
          labelFont: '12px system-ui',
          size: 65,
          side: 1,
          stroke: '#64748b',
          font: '11px system-ui',
          grid: { show: false },
          values: (_u, splits) => splits.map((s) => String(s)),
        },
      ],
      series: [
        {},
        {
          label: 'pH',
          scale: 'ph',
          stroke: '#0f172a',
          width: 1.5,
          points: { show: false },
        },
        ...CHANNELS.map((c) => ({
          label: `${c.label} 阻抗`,
          scale: 'imp' as const,
          stroke: c.color,
          width: 0.9,
          points: { show: false },
          show: visibleImp.has(c.key as string),
        })),
      ],
      hooks: {
        // 让 uPlot 缩放后通知外部
        setScale: [
          (u, key) => {
            if (key !== 'x') return;
            const min = u.scales.x.min!;
            const max = u.scales.x.max!;
            const current = xRangeRef.current;
            // 避免 toggle 通道导致的循环触发
            if (current && Math.abs(current.min - min) < 0.5 && Math.abs(current.max - max) < 0.5) return;
            if (!current && min < 0.5 && max > totalDuration - 0.5) return;
            // 限制最小窗口
            if (max - min < MIN_RANGE_S) return;
            if (min < 0.5 && max > totalDuration - 0.5) {
              onXRangeChange(null);
            } else {
              onXRangeChange({ min, max });
            }
          },
        ],
        draw: [
          (u: uPlot) => {
            const ctx = u.ctx;
            ctx.save();

            // 1) pH=4 红虚线
            ctx.strokeStyle = '#dc262670';
            ctx.setLineDash([6, 4]);
            ctx.lineWidth = 1.2;
            const y4 = u.valToPos(4, 'ph', true);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y4);
            ctx.lineTo(u.bbox.left + u.bbox.width, y4);
            ctx.stroke();
            ctx.fillStyle = '#dc2626';
            ctx.font = '11px system-ui';
            ctx.fillText('酸阈值 pH=4', u.bbox.left + 6, y4 - 4);
            ctx.setLineDash([]);

            // 2) 50% 阻抗参考线（缩放到反流尺度时显示）
            if (visRange < 600 && visibleImp.size > 0) {
              ctx.strokeStyle = '#94a3b860';
              ctx.lineWidth = 1;
              ctx.setLineDash([2, 2]);
              const y50 = u.valToPos(50, 'imp', true);
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, y50);
              ctx.lineTo(u.bbox.left + u.bbox.width, y50);
              ctx.stroke();
              ctx.fillStyle = '#64748b';
              ctx.font = '10px system-ui';
              ctx.fillText('50% 阻抗阈值', u.bbox.left + 6, y50 - 3);
              ctx.setLineDash([]);
            }

            // 3) 事件色带（顶部独立轨道）
            const trackTop = u.bbox.top - EVENT_TRACK_H - 8;
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(u.bbox.left, trackTop, u.bbox.width, EVENT_TRACK_H);
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            ctx.strokeRect(u.bbox.left + 0.5, trackTop + 0.5, u.bbox.width - 1, EVENT_TRACK_H - 1);
            ctx.fillStyle = '#64748b';
            ctx.font = '10px system-ui';
            ctx.fillText('反流事件', u.bbox.left + 4, trackTop - 4);

            for (const ev of events) {
              if (ev.end_s < u.scales.x.min! || ev.start_s > u.scales.x.max!) continue;
              const x1 = u.valToPos(ev.start_s, 'x', true);
              const x2 = u.valToPos(ev.end_s, 'x', true);
              const bw = Math.max(4, x2 - x1);
              const sel = ev.id === selectedId;
              const sevH = ev.severity === 'severe' ? EVENT_TRACK_H - 8
                : ev.severity === 'moderate' ? EVENT_TRACK_H - 18
                : EVENT_TRACK_H - 28;
              const yTop = trackTop + (EVENT_TRACK_H - sevH) / 2;
              ctx.fillStyle = TYPE_COLOR[ev.type];
              ctx.globalAlpha = sel ? 1 : 0.85;
              ctx.fillRect(x1, yTop, bw, sevH);
              ctx.globalAlpha = 1;
              if (sel) {
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 2;
                ctx.strokeRect(x1 - 1.5, yTop - 1.5, bw + 3, sevH + 3);
              }
            }

            // 4) 缩放到单个事件时的注解
            if (focusedEvent) {
              const ev = focusedEvent;
              const x1 = u.valToPos(ev.start_s, 'x', true);
              const x2 = u.valToPos(ev.end_s, 'x', true);

              // 事件背景（淡红高亮区域）
              ctx.fillStyle = '#fee2e240';
              ctx.fillRect(x1, u.bbox.top, x2 - x1, u.bbox.height);
              // 起止粗竖线
              ctx.strokeStyle = '#dc2626';
              ctx.lineWidth = 2.5;
              ctx.setLineDash([6, 4]);
              ctx.beginPath();
              ctx.moveTo(x1, u.bbox.top);
              ctx.lineTo(x1, u.bbox.top + u.bbox.height);
              ctx.moveTo(x2, u.bbox.top);
              ctx.lineTo(x2, u.bbox.top + u.bbox.height);
              ctx.stroke();
              ctx.setLineDash([]);

              // 起止标签（大字 + 红底白字胶囊）
              const drawPill = (
                text: string,
                anchorX: number,
                cy: number,
                bg: string,
                opts: { fg?: string; align?: 'center' | 'left' } = {},
              ) => {
                const { fg = '#fff', align = 'center' } = opts;
                ctx.font = 'bold 14px system-ui';
                const w = ctx.measureText(text).width + 16;
                const h = 24;
                const left = align === 'center' ? anchorX - w / 2 : anchorX;
                ctx.fillStyle = bg;
                ctx.beginPath();
                if ((ctx as unknown as { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect) {
                  (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(left, cy - h / 2, w, h, 6);
                } else {
                  ctx.rect(left, cy - h / 2, w, h);
                }
                ctx.fill();
                ctx.fillStyle = fg;
                ctx.textAlign = align === 'center' ? 'center' : 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, align === 'center' ? anchorX : left + 8, cy);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
              };
              drawPill('▼ 反流开始', x1, u.bbox.top - 14, '#dc2626');
              drawPill('反流结束 ▼', x2, u.bbox.top - 14, '#dc2626');

              // 时长横向标尺（事件区上方 + 大字）
              const midX = (x1 + x2) / 2;
              ctx.strokeStyle = '#dc2626';
              ctx.lineWidth = 2;
              const rulerY = u.bbox.top + 14;
              ctx.beginPath();
              ctx.moveTo(x1 + 4, rulerY);
              ctx.lineTo(x2 - 4, rulerY);
              ctx.stroke();
              // 端点小三角
              const arrowSize = 6;
              ctx.fillStyle = '#dc2626';
              ctx.beginPath();
              ctx.moveTo(x1, rulerY);
              ctx.lineTo(x1 + arrowSize, rulerY - arrowSize / 2);
              ctx.lineTo(x1 + arrowSize, rulerY + arrowSize / 2);
              ctx.closePath();
              ctx.fill();
              ctx.beginPath();
              ctx.moveTo(x2, rulerY);
              ctx.lineTo(x2 - arrowSize, rulerY - arrowSize / 2);
              ctx.lineTo(x2 - arrowSize, rulerY + arrowSize / 2);
              ctx.closePath();
              ctx.fill();
              // 时长大字
              drawPill(`持续 ${fmtDuration(ev.duration_s)}`, midX, rulerY + 18, '#0f172a');

              // pH 谷值标记（大圆点 + 胶囊标签）
              const t = overview.t;
              const phMin = overview.pH_min;
              let nadirIdx = 0;
              let nadirVal = phMin[0] ?? 7;
              for (let i = 0; i < t.length; i++) {
                if (t[i] >= ev.start_s && t[i] <= ev.end_s + 30 && phMin[i] < nadirVal) {
                  nadirVal = phMin[i];
                  nadirIdx = i;
                }
              }
              const nadirX = u.valToPos(t[nadirIdx], 'x', true);
              const nadirY = u.valToPos(nadirVal, 'ph', true);
              ctx.fillStyle = '#dc2626';
              ctx.beginPath();
              ctx.arc(nadirX, nadirY, 7, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 2;
              ctx.stroke();
              drawPill(`pH ↓ ${nadirVal.toFixed(1)}`, nadirX + 10, nadirY, '#0f172a', { align: 'left' });

              // 近端到达高度（右侧大标注 + 箭头 + 在最高涉及通道画水平指示）
              const targetChannel = CHANNELS.find((c) => c.cm === ev.proximal_extent_cm);
              if (targetChannel) {
                const channelData = overview[targetChannel.key] as number[];
                // 在事件窗口内取该通道的最低点（最深下降）位置
                let minIdx = 0;
                let minVal = channelData[0] ?? 100;
                for (let i = 0; i < t.length; i++) {
                  if (t[i] >= ev.start_s && t[i] <= ev.end_s && channelData[i] < minVal) {
                    minVal = channelData[i];
                    minIdx = i;
                  }
                }
                const arrowX = u.valToPos(t[minIdx], 'x', true);
                const arrowY = u.valToPos(minVal, 'imp', true);
                // 从最低点画一条短水平线 + 箭头指向右
                ctx.strokeStyle = targetChannel.color;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(arrowX, arrowY);
                ctx.lineTo(arrowX + 24, arrowY);
                ctx.stroke();
                // 箭头三角
                ctx.fillStyle = targetChannel.color;
                ctx.beginPath();
                ctx.moveTo(arrowX + 30, arrowY);
                ctx.lineTo(arrowX + 22, arrowY - 5);
                ctx.lineTo(arrowX + 22, arrowY + 5);
                ctx.closePath();
                ctx.fill();
                // 标签胶囊
                const labelText = ev.proximal_extent_cm >= 15
                  ? `反流到达 ${ev.proximal_extent_cm} cm（咽喉部）`
                  : ev.proximal_extent_cm >= 9
                    ? `反流到达 ${ev.proximal_extent_cm} cm（食道中段）`
                    : `反流到达 ${ev.proximal_extent_cm} cm（食道下段）`;
                drawPill(labelText, arrowX + 34, arrowY, targetChannel.color, { align: 'left' });
              }
            }

            ctx.restore();
          },
        ],
        ready: [
          (u: uPlot) => {
            u.over.style.cursor = 'default';
          },
        ],
      },
    };

    if (plotRef.current) plotRef.current.destroy();
    plotRef.current = new uPlot(opts, series, containerRef.current);

    const onResize = () => {
      if (plotRef.current && containerRef.current) {
        plotRef.current.setSize({ width: containerRef.current.clientWidth, height: h });
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // 仅在 series/events/visibleImp 变化时重建图（不依赖 xRange 防循环）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, events, visibleImp, selectedId, focusedEvent, view]);

  // xRange 变化时只 setScale，不重建图
  useEffect(() => {
    if (!plotRef.current) return;
    const min = xRange?.min ?? 0;
    const max = xRange?.max ?? totalDuration;
    if (min === plotRef.current.scales.x.min && max === plotRef.current.scales.x.max) return;
    plotRef.current.setScale('x', { min, max });
  }, [xRange, totalDuration]);

  function toggleChannel(key: string) {
    setVisibleImp((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // 把覆盖层的客户端 x 坐标转成事件 ID（如有命中）
  function hitTestEventAt(clientX: number, currentTarget: HTMLElement): RefluxEvent | null {
    const u = plotRef.current;
    if (!u) return null;
    const rect = currentTarget.getBoundingClientRect();
    const x = clientX - rect.left;
    // u.bbox 在 CSS 像素中，相对于 .uplot 元素左上角；containerRef 即 .uplot 容器
    if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) return null;
    const t = u.posToVal(x - u.bbox.left, 'x');
    // 命中容差：远端比近端宽，时间范围越大容差越大
    const tol = Math.max(15, (u.scales.x.max! - u.scales.x.min!) / 200);
    let best: RefluxEvent | null = null;
    let bestDist = Infinity;
    for (const ev of events) {
      if (t >= ev.start_s - tol && t <= ev.end_s + tol) {
        const center = (ev.start_s + ev.end_s) / 2;
        const d = Math.abs(t - center);
        if (d < bestDist) { best = ev; bestDist = d; }
      }
    }
    return best;
  }

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    const hit = hitTestEventAt(e.clientX, e.currentTarget);
    if (hit) onSelect(hit.id);
  }

  function handleTrackMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!tooltipRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = hitTestEventAt(e.clientX, e.currentTarget);
    if (hit) {
      tooltipRef.current.style.display = 'block';
      tooltipRef.current.style.left = `${e.clientX - rect.left + 12}px`;
      tooltipRef.current.style.top = `${e.clientY - rect.top + 8}px`;
      tooltipRef.current.innerHTML = `
        <div class="font-medium">#${hit.id + 1} · ${TYPE_LABEL[hit.type]}</div>
        <div class="text-xs opacity-80">${fmtTime(hit.start_s)} · 持续 ${fmtDuration(hit.duration_s)}</div>
        <div class="text-xs opacity-80">近端 ${hit.proximal_extent_cm} cm · pH↓ ${hit.ph_nadir} · 点击放大</div>
      `;
    } else {
      tooltipRef.current.style.display = 'none';
    }
  }

  function handleTrackMouseLeave() {
    if (tooltipRef.current) tooltipRef.current.style.display = 'none';
  }

  const acidCount = events.filter((e) => e.type === 'acid').length;
  const weakCount = events.filter((e) => e.type === 'weakly_acidic').length;
  const nonCount = events.filter((e) => e.type === 'non_acid_bolus' || e.type === 'weakly_alkaline').length;

  // 当前缩放比例标签
  const isZoomed = visRange < totalDuration - 1;
  const zoomLabel = isZoomed
    ? (focusedEvent
        ? `事件 #${focusedEvent.id + 1} · ${TYPE_LABEL[focusedEvent.type]}`
        : `局部 ${fmtDuration(visRange)}`)
    : '全程 24 小时';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
      <div className="flex items-center justify-between mb-2 px-1 flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium text-slate-700">食道阻抗-pH 时间序列</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              点击顶部色带跳转到该事件 · 用下方蓝色窗口拖动/缩放查看不同时段
            </div>
          </div>
          <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">
            {zoomLabel}
          </span>
          {isZoomed && (
            <button
              onClick={onResetZoom}
              className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
            >
              ↺ 重置 24h
            </button>
          )}
        </div>
        <div className="text-xs text-slate-600 flex items-center gap-3 flex-wrap">
          <Legend color={TYPE_COLOR.acid} label={`强酸 ${acidCount}`} />
          <Legend color={TYPE_COLOR.weakly_acidic} label={`弱酸 ${weakCount}`} />
          <Legend color={TYPE_COLOR.non_acid_bolus} label={`非酸 ${nonCount}`} />
          <span className="text-slate-400">·</span>
          <span className="text-[11px] text-slate-500">条高度=严重度</span>
        </div>
      </div>
      <div className="relative">
        <div ref={containerRef} className="w-full" style={{ height: 420, overflow: 'hidden' }} />
        {/* 顶部事件色带 HTML 覆盖层（处理点击/悬停） */}
        <div
          className="absolute left-0 right-0 cursor-pointer z-10"
          style={{ top: 0, height: EVENT_TRACK_H + TRACK_OVERLAY_PAD * 2 }}
          onClick={handleTrackClick}
          onMouseMove={handleTrackMouseMove}
          onMouseLeave={handleTrackMouseLeave}
        />
        <div
          ref={tooltipRef}
          className="absolute pointer-events-none bg-slate-900 text-white text-sm rounded shadow-lg px-2 py-1.5 z-20"
          style={{ display: 'none' }}
        />
      </div>

      {/* 底部范围条 */}
      <div className="mt-2 px-1">
        <RangeSlider
          totalDuration={totalDuration}
          range={xRange}
          onChange={onXRangeChange}
          events={events}
          minRangeS={MIN_RANGE_S}
        />
      </div>

      {/* 通道开关 */}
      <div className="mt-3 px-1 flex items-center gap-2 flex-wrap text-xs">
        <span className="text-slate-500">阻抗通道（可叠加）：</span>
        {CHANNELS.map((c) => {
          const on = visibleImp.has(c.key as string);
          return (
            <button
              key={c.key as string}
              onClick={() => toggleChannel(c.key as string)}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border transition ${
                on
                  ? 'bg-slate-50 border-slate-300 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-700 hover:border-slate-200'
              }`}
              title={`${c.cm} cm above LES`}
            >
              <span className="inline-block w-3 h-0.5" style={{ background: c.color }} />
              <span>{c.label}</span>
            </button>
          );
        })}
        {visibleImp.size > 0 && (
          <button
            onClick={() => setVisibleImp(new Set())}
            className="ml-2 text-slate-400 hover:text-slate-700 underline underline-offset-2"
          >
            全部隐藏
          </button>
        )}
      </div>

      {view === 'patient' && !isZoomed && (
        <div className="mt-3 px-3 py-2.5 text-xs text-slate-600 leading-relaxed bg-blue-50/60 border border-blue-100 rounded">
          <div className="font-medium text-slate-800 mb-1">怎么看这张图</div>
          <div>
            横轴是 <strong>24 小时时间</strong>。顶部彩色方块是
            <strong>自动检测到的反流事件</strong>——
            <span style={{ color: TYPE_COLOR.acid, fontWeight: 600 }}>红色</span>=强酸、
            <span style={{ color: TYPE_COLOR.weakly_acidic, fontWeight: 600 }}>黄色</span>=弱酸、
            <span style={{ color: TYPE_COLOR.non_acid_bolus, fontWeight: 600 }}>蓝色</span>=非酸；
            方块越高代表越严重。中间黑色细线是 <strong>pH</strong>，向下凹=变酸了，红色虚线是 pH=4 酸阈。
            <br />
            <strong>点一下任意彩色方块，整张图会自动放大到那次反流的细节</strong>，并显示反流开始/结束、pH 最低点、反流最高到达的位置。
            <br />
            想看任意时段：<strong>用下方蓝色窗口</strong>——拖中间平移、拖左右手柄缩放、点空白处跳转；或点右上角「↺ 重置 24h」回到全程。
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-sm" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}
