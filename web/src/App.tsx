import { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { SummaryPanel } from './components/SummaryPanel';
import { Timeline } from './components/Timeline';
import { EventList } from './components/EventList';
import { EventDetail } from './components/EventDetail';
import { useEvents, useOverview, useSummary } from './data';
import type { ViewMode } from './types';

const EVENT_PAD_S = 12; // 点击事件时左右各留 12s 上下文（足够看清前后变化，又不浪费空间）

function App() {
  const [view, setView] = useState<ViewMode>('patient');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // 当前可视时间范围（秒）。null = 全程
  const [xRange, setXRange] = useState<{ min: number; max: number } | null>(null);

  const summary = useSummary();
  const events = useEvents();
  const overview = useOverview();

  const selectedEvent = events?.find((e) => e.id === selectedId) ?? null;
  const totalDuration = overview ? overview.n_samples / overview.sample_rate_hz : 0;

  // 选中事件时自动缩放到该事件窗口
  useEffect(() => {
    if (!selectedEvent) return;
    const min = Math.max(0, selectedEvent.start_s - EVENT_PAD_S);
    const max = Math.min(totalDuration, selectedEvent.end_s + EVENT_PAD_S);
    setXRange({ min, max });
  }, [selectedEvent, totalDuration]);

  function handleResetZoom() {
    setXRange(null);
    setSelectedId(null);
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Header view={view} onViewChange={setView} />

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 py-4 space-y-4">
        {!summary || !events || !overview ? (
          <div className="flex items-center justify-center h-64 text-slate-400">
            正在载入数据 ...
          </div>
        ) : (
          <>
            <SummaryPanel summary={summary} view={view} />

            <Timeline
              overview={overview}
              events={events}
              selectedId={selectedId}
              onSelect={setSelectedId}
              view={view}
              xRange={xRange}
              onXRangeChange={setXRange}
              onResetZoom={handleResetZoom}
              totalDuration={totalDuration}
            />

            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
              <EventList
                events={events}
                selectedId={selectedId}
                onSelect={setSelectedId}
                view={view}
              />
              <EventDetail event={selectedEvent} view={view} />
            </div>
          </>
        )}
      </main>

      <footer className="text-center text-xs text-slate-400 py-4 border-t border-slate-200 bg-white">
        基于 Lyon Consensus 2.0 (2024) 与 Porto Consensus 算法 · 本工具仅用于研究和教育，不能替代专业医疗诊断
      </footer>
    </div>
  );
}

export default App;
