import { useEffect, useRef, useState } from 'react';
import type { RefluxEvent } from '../types';
import { TYPE_COLOR, fmtTime } from '../explain';

interface Props {
  totalDuration: number;
  range: { min: number; max: number } | null;
  onChange: (r: { min: number; max: number } | null) => void;
  events: RefluxEvent[];
  minRangeS: number;
}

type DragMode = null | 'pan' | 'left' | 'right';

// 底部范围条：显示 24h 全程 + 当前可视窗口高亮
// 拖中间=平移；拖左右边缘=缩放
export function RangeSlider({ totalDuration, range, onChange, events, minRangeS }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    mode: DragMode;
    startX: number;
    startMin: number;
    startMax: number;
  } | null>(null);

  const min = range?.min ?? 0;
  const max = range?.max ?? totalDuration;
  const leftPct = (min / totalDuration) * 100;
  const widthPct = ((max - min) / totalDuration) * 100;

  function onMouseDown(mode: DragMode) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDrag({ mode, startX: e.clientX, startMin: min, startMax: max });
    };
  }

  useEffect(() => {
    if (!drag || !trackRef.current) return;
    const trackW = trackRef.current.clientWidth;
    const sToPx = trackW / totalDuration;

    function onMove(e: MouseEvent) {
      if (!drag) return;
      const deltaPx = e.clientX - drag.startX;
      const deltaS = deltaPx / sToPx;

      if (drag.mode === 'pan') {
        const len = drag.startMax - drag.startMin;
        let newMin = drag.startMin + deltaS;
        let newMax = drag.startMax + deltaS;
        if (newMin < 0) { newMin = 0; newMax = len; }
        if (newMax > totalDuration) { newMax = totalDuration; newMin = newMax - len; }
        onChange({ min: newMin, max: newMax });
      } else if (drag.mode === 'left') {
        let newMin = drag.startMin + deltaS;
        if (newMin < 0) newMin = 0;
        if (drag.startMax - newMin < minRangeS) newMin = drag.startMax - minRangeS;
        onChange({ min: newMin, max: drag.startMax });
      } else if (drag.mode === 'right') {
        let newMax = drag.startMax + deltaS;
        if (newMax > totalDuration) newMax = totalDuration;
        if (newMax - drag.startMin < minRangeS) newMax = drag.startMin + minRangeS;
        onChange({ min: drag.startMin, max: newMax });
      }
    }
    function onUp() {
      // 拖到接近全程则视为重置
      const cur = trackRef.current;
      if (cur) {
        // 状态由 onChange 同步
      }
      setDrag(null);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [drag, totalDuration, minRangeS, onChange]);

  // 点击空白区域 = 跳转到那个时刻（保持当前窗口大小）
  function onTrackClick(e: React.MouseEvent) {
    if (drag) return;
    const rect = trackRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = (px / rect.width) * totalDuration;
    const len = max - min;
    let newMin = t - len / 2;
    let newMax = t + len / 2;
    if (newMin < 0) { newMin = 0; newMax = len; }
    if (newMax > totalDuration) { newMax = totalDuration; newMin = newMax - len; }
    onChange({ min: newMin, max: newMax });
  }

  return (
    <div className="select-none">
      <div className="flex justify-between text-[10px] text-slate-400 mb-0.5 font-mono px-0.5">
        <span>{fmtTime(0)}</span>
        <span>{fmtTime(min)} → {fmtTime(max)}</span>
        <span>{fmtTime(totalDuration)}</span>
      </div>
      <div
        ref={trackRef}
        className="relative h-7 bg-slate-100 rounded cursor-pointer"
        onClick={onTrackClick}
      >
        {/* 全程事件点（淡色） */}
        <div className="absolute inset-0 overflow-hidden rounded">
          {events.map((ev) => {
            const px = (ev.start_s / totalDuration) * 100;
            return (
              <div
                key={ev.id}
                className="absolute top-0 bottom-0 w-px"
                style={{ left: `${px}%`, background: TYPE_COLOR[ev.type] + 'b0' }}
              />
            );
          })}
        </div>
        {/* 当前可视窗口高亮 */}
        <div
          className="absolute top-0 bottom-0 bg-blue-500/20 border border-blue-500"
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, cursor: drag?.mode === 'pan' ? 'grabbing' : 'grab' }}
          onMouseDown={onMouseDown('pan')}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 左手柄 */}
          <div
            className="absolute -left-1 top-0 bottom-0 w-2 bg-blue-500 rounded-l cursor-ew-resize hover:bg-blue-600"
            onMouseDown={onMouseDown('left')}
            onClick={(e) => e.stopPropagation()}
          />
          {/* 右手柄 */}
          <div
            className="absolute -right-1 top-0 bottom-0 w-2 bg-blue-500 rounded-r cursor-ew-resize hover:bg-blue-600"
            onMouseDown={onMouseDown('right')}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
    </div>
  );
}
