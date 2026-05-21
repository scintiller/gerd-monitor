import { useEffect, useMemo, useState } from 'react';
import { Header } from './components/Header';
import { SummaryPanel } from './components/SummaryPanel';
import { Timeline } from './components/Timeline';
import { EventList } from './components/EventList';
import { EventDetail } from './components/EventDetail';
import { Landing } from './components/Landing';
import { useEvents, useOverview, useSummary } from './data';
import { useAnalyzer } from './analyzer/useAnalyzer';
import type { ViewMode, Summary, RefluxEvent, Overview } from './types';

const EVENT_PAD_S = 12;

type DataSource = 'landing' | 'sample' | 'uploaded';

function App() {
  const [view, setView] = useState<ViewMode>('patient');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [xRange, setXRange] = useState<{ min: number; max: number } | null>(null);
  const [source, setSource] = useState<DataSource>('landing');
  const { status, analyze, reset } = useAnalyzer();

  // 样例数据（仅在 source === 'sample' 时使用）
  const sampleSummary = useSummary();
  const sampleEvents = useEvents();
  const sampleOverview = useOverview();

  // 选数据源
  const { summary, events, overview } = useMemo<{
    summary: Summary | null; events: RefluxEvent[] | null; overview: Overview | null;
  }>(() => {
    if (source === 'sample') {
      return { summary: sampleSummary, events: sampleEvents, overview: sampleOverview };
    }
    if (source === 'uploaded' && status.kind === 'done') {
      return { summary: status.data.summary, events: status.data.events, overview: status.data.overview };
    }
    return { summary: null, events: null, overview: null };
  }, [source, status, sampleSummary, sampleEvents, sampleOverview]);

  const selectedEvent = events?.find((e) => e.id === selectedId) ?? null;
  const totalDuration = overview ? overview.n_samples / overview.sample_rate_hz : 0;

  useEffect(() => {
    if (!selectedEvent) return;
    const min = Math.max(0, selectedEvent.start_s - EVENT_PAD_S);
    const max = Math.min(totalDuration, selectedEvent.end_s + EVENT_PAD_S);
    setXRange({ min, max });
  }, [selectedEvent, totalDuration]);

  // 上传完成后自动切到 dashboard
  useEffect(() => {
    if (status.kind === 'done') setSource('uploaded');
  }, [status]);

  function handleResetZoom() {
    setXRange(null);
    setSelectedId(null);
  }

  function handleBackToLanding() {
    reset();
    setSelectedId(null);
    setXRange(null);
    setSource('landing');
  }

  // 渲染：landing / loading / dashboard
  if (source === 'landing' || (source === 'uploaded' && status.kind !== 'done')) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                食
              </div>
              <div>
                <h1 className="text-base font-semibold text-slate-900 leading-tight">食管阻抗-pH 监测分析</h1>
                <div className="text-xs text-slate-500">基于 Lyon Consensus 2.0</div>
              </div>
            </div>
            <a
              href="https://github.com/scintiller/gerd-monitor"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              GitHub ↗
            </a>
          </div>
        </header>
        <main className="flex-1">
          <Landing
            onChooseSample={() => setSource('sample')}
            onUpload={(file) => analyze(file)}
            status={status}
            onReset={() => { reset(); }}
          />
        </main>
        <footer className="text-center text-xs text-slate-400 py-4 border-t border-slate-200 bg-white">
          基于 Lyon Consensus 2.0 (2024) 与 Porto Consensus 算法 · 本工具仅用于研究和教育，不能替代专业医疗诊断
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Header view={view} onViewChange={setView} sourceLabel={source === 'sample' ? '样例 · 病例 001' : '已上传数据'} onBackToLanding={handleBackToLanding} />

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
