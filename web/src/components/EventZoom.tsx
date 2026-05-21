import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import type { RefluxEvent, ViewMode, Zoom } from '../types';
import { fmtTime } from '../explain';

interface Props {
  zoom: Zoom;
  event: RefluxEvent;
  view: ViewMode;
}

interface ChannelDef {
  label: string;
  color: string;
  cm: number;
  key: keyof Zoom;
}

const ALL_CHANNELS: ChannelDef[] = [
  { label: '3 cm 阻抗', color: '#0284c7', cm: 3, key: 'Imp11' },
  { label: '5 cm', color: '#0369a1', cm: 5, key: 'Imp12' },
  { label: '7 cm', color: '#0e7490', cm: 7, key: 'Imp13' },
  { label: '9 cm', color: '#0d9488', cm: 9, key: 'Imp14' },
  { label: '15 cm', color: '#7c3aed', cm: 15, key: 'Imp16' },
  { label: '17 cm', color: '#5b21b6', cm: 17, key: 'Imp17' },
];

// 单事件高清放大图
// 病人视角：只显示这次反流真正涉及的通道（≤近端到达），+ 注解
// 医生视角：6 个通道全显示，仅高亮涉及通道
export function EventZoom({ zoom, event, view }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  // 哪些通道被这次反流"涉及"？高度 ≤ proximal_extent 即涉及
  const channelDefs = useMemo(() => {
    return ALL_CHANNELS.map((c) => ({
      ...c,
      involved: c.cm <= event.proximal_extent_cm,
    }));
  }, [event.proximal_extent_cm]);

  // 病人视角：只画涉及的通道；医生视角：全部画但未涉及的弱化
  const visibleChannels = useMemo(() => {
    return view === 'patient' ? channelDefs.filter((c) => c.involved) : channelDefs;
  }, [channelDefs, view]);

  const data = useMemo(() => {
    return [
      zoom.t,
      zoom.pH,
      ...visibleChannels.map((c) => zoom[c.key] as number[]),
    ] as uPlot.AlignedData;
  }, [zoom, visibleChannels]);

  useEffect(() => {
    if (!containerRef.current) return;
    const w = containerRef.current.clientWidth;
    const h = 320;

    const opts: uPlot.Options = {
      width: w,
      height: h,
      legend: { show: false },
      padding: [30, 12, 4, 12], // 顶部留空间画 "反流开始/结束" 标签
      cursor: { drag: { x: true, y: false } },
      scales: {
        x: { time: false },
        ph: { range: [0, 9] },
        imp: { range: [0, 130] },
      },
      axes: [
        {
          values: (_u, splits) => splits.map((s) => fmtTime(s as number)),
          space: 80,
          stroke: '#64748b',
          font: '11px system-ui',
        },
        {
          scale: 'ph',
          label: 'pH',
          labelSize: 14,
          size: 45,
          stroke: '#0f172a',
          font: '11px system-ui',
        },
        {
          scale: 'imp',
          label: '阻抗 (%)',
          labelSize: 14,
          size: 55,
          side: 1,
          stroke: '#64748b',
          font: '11px system-ui',
          grid: { show: false },
        },
      ],
      series: [
        {},
        {
          label: 'pH',
          scale: 'ph',
          stroke: '#0f172a',
          width: 2,
          points: { show: false },
        },
        ...visibleChannels.map((c) => ({
          label: c.label,
          scale: 'imp' as const,
          stroke: c.involved ? c.color : c.color + '60',
          width: c.involved ? 1.5 : 0.7,
          points: { show: false },
        })),
      ],
      hooks: {
        draw: [
          (u: uPlot) => {
            const ctx = u.ctx;
            const ph = zoom.pH;
            const t = zoom.t;

            ctx.save();

            // 1) 事件时段背景（粉色）+ 起止竖线
            const x1 = u.valToPos(event.start_s, 'x', true);
            const x2 = u.valToPos(event.end_s, 'x', true);
            ctx.fillStyle = '#fee2e240';
            ctx.fillRect(x1, u.bbox.top, x2 - x1, u.bbox.height);
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(x1, u.bbox.top);
            ctx.lineTo(x1, u.bbox.top + u.bbox.height);
            ctx.moveTo(x2, u.bbox.top);
            ctx.lineTo(x2, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.setLineDash([]);

            // 2) 顶部标签 "反流开始" / "反流结束"
            ctx.fillStyle = '#dc2626';
            ctx.font = 'bold 11px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('▼ 反流开始', x1, u.bbox.top - 10);
            ctx.fillText('反流结束（食管清除） ▼', x2, u.bbox.top - 10);
            ctx.textAlign = 'left';

            // 3) 50% 阻抗阈值参考线
            ctx.strokeStyle = '#94a3b870';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            const y50 = u.valToPos(50, 'imp', true);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y50);
            ctx.lineTo(u.bbox.left + u.bbox.width, y50);
            ctx.stroke();
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px system-ui';
            ctx.fillText('50% 阻抗阈值（判定反流的基准线）', u.bbox.left + 6, y50 - 3);

            // 4) pH=4 酸阈值线
            ctx.strokeStyle = '#dc262670';
            const y4 = u.valToPos(4, 'ph', true);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y4);
            ctx.lineTo(u.bbox.left + u.bbox.width, y4);
            ctx.stroke();
            ctx.fillStyle = '#dc2626';
            ctx.fillText('pH=4 酸阈值', u.bbox.left + 6, y4 - 3);
            ctx.setLineDash([]);

            // 5) pH 谷值标记
            let nadirIdx = 0;
            let nadirVal = ph[0];
            for (let i = 0; i < ph.length; i++) {
              if (t[i] >= event.start_s && t[i] <= event.end_s + 30 && ph[i] < nadirVal) {
                nadirVal = ph[i];
                nadirIdx = i;
              }
            }
            const nadirX = u.valToPos(t[nadirIdx], 'x', true);
            const nadirY = u.valToPos(nadirVal, 'ph', true);
            ctx.fillStyle = '#dc2626';
            ctx.beginPath();
            ctx.arc(nadirX, nadirY, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = 'bold 11px system-ui';
            ctx.fillStyle = '#0f172a';
            ctx.fillText(`pH 最低 ${nadirVal.toFixed(1)}`, nadirX + 8, nadirY + 4);

            // 6) 近端到达高度注解（右侧）
            ctx.fillStyle = '#1e40af';
            ctx.font = 'bold 11px system-ui';
            ctx.textAlign = 'right';
            const noteX = u.bbox.left + u.bbox.width - 8;
            const noteY = u.bbox.top + 18;
            ctx.fillText(`📍 反流最高到达 ${event.proximal_extent_cm} cm`, noteX, noteY);
            ctx.textAlign = 'left';

            // 7) 病人视角：底部"画外音"
            if (view === 'patient') {
              ctx.fillStyle = '#64748b';
              ctx.font = '10px system-ui';
              const hintY = u.bbox.top + u.bbox.height + 18;
              const hint = visibleChannels.length === 1
                ? '只显示这次反流真正到达的位置（其他位置基本没动）'
                : `只显示这次反流真正到达的 ${visibleChannels.length} 个位置（其他位置基本没动）`;
              ctx.fillText(hint, u.bbox.left, hintY);
            }

            ctx.restore();
          },
        ],
      },
    };

    if (plotRef.current) plotRef.current.destroy();
    plotRef.current = new uPlot(opts, data, containerRef.current);

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
  }, [data, event, view, zoom, visibleChannels]);

  return (
    <div>
      <div ref={containerRef} className="w-full" style={{ height: 320, overflow: 'hidden' }} />
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600 px-2">
        <LegendItem color="#0f172a" label="pH" thick />
        {visibleChannels.map((c) => (
          <LegendItem
            key={c.cm}
            color={c.involved ? c.color : c.color + '60'}
            label={c.label.replace(' 阻抗', '') + (c.involved && view === 'doctor' ? ' ★' : '')}
            thick={c.involved}
          />
        ))}
        <span className="text-slate-400">·</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-red-100" />
          反流时段
        </span>
        {view === 'doctor' && (
          <span className="text-slate-500 ml-1">★ = 涉及通道</span>
        )}
      </div>
    </div>
  );
}

function LegendItem({ color, label, thick }: { color: string; label: string; thick?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-3"
        style={{ background: color, height: thick ? 2 : 1 }}
      />
      <span className={thick ? '' : 'text-slate-400'}>{label}</span>
    </span>
  );
}
