import { useState } from 'react';
import type { RefluxEvent, ViewMode } from '../types';
import { TYPE_LABEL, TYPE_PATIENT_LABEL, TYPE_COLOR, SEVERITY_LABEL, SEVERITY_COLOR, fmtTime, fmtDuration } from '../explain';

interface Props {
  events: RefluxEvent[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  view: ViewMode;
}

export function EventList({ events, selectedId, onSelect, view }: Props) {
  const [filter, setFilter] = useState<'all' | 'acid' | 'weakly_acidic' | 'severe'>('all');

  const filtered = events.filter((ev) => {
    if (filter === 'all') return true;
    if (filter === 'severe') return ev.severity !== 'mild';
    return ev.type === filter;
  });

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 flex flex-col overflow-hidden" style={{ maxHeight: 620 }}>
      <div className="p-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
        <div>
          <div className="text-sm font-medium text-slate-700">
            反流事件 ({filtered.length}/{events.length})
          </div>
          <div className="text-xs text-slate-500">按时间排序，点击查看详情</div>
        </div>
        <select
          className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'all' | 'acid' | 'weakly_acidic' | 'severe')}
        >
          <option value="all">全部</option>
          <option value="acid">仅酸反流</option>
          <option value="weakly_acidic">仅弱酸</option>
          <option value="severe">中度+重度</option>
        </select>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((ev) => {
          const isSel = ev.id === selectedId;
          return (
            <button
              key={ev.id}
              onClick={() => onSelect(ev.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-slate-100 transition flex items-start gap-2.5 hover:bg-slate-50 ${
                isSel ? 'bg-blue-50' : ''
              }`}
            >
              <div
                className="mt-1 w-1 self-stretch rounded-full flex-shrink-0"
                style={{ background: TYPE_COLOR[ev.type] }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-xs text-slate-600">
                    #{ev.id + 1} · {fmtTime(ev.start_s)}
                  </div>
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded text-white"
                    style={{ background: SEVERITY_COLOR[ev.severity] }}
                  >
                    {SEVERITY_LABEL[ev.severity]}
                  </span>
                </div>
                <div className="text-sm text-slate-800 mt-0.5">
                  {view === 'patient' ? TYPE_PATIENT_LABEL[ev.type] : TYPE_LABEL[ev.type]}
                </div>
                <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3">
                  <span>持续 {fmtDuration(ev.duration_s)}</span>
                  <span>pH↓ {ev.ph_nadir}</span>
                  <span>近端 {ev.proximal_extent_cm} cm</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
