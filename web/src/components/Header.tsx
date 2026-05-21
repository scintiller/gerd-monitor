import type { ViewMode } from '../types';

interface Props {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  sourceLabel?: string;
  onBackToLanding?: () => void;
}

export function Header({ view, onViewChange, sourceLabel, onBackToLanding }: Props) {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
            食
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900 leading-tight">
              24 小时食管阻抗-pH 监测分析
            </h1>
            <div className="text-xs text-slate-500">
              {sourceLabel ?? '病例 001 · 23.76 小时记录'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {onBackToLanding && (
            <button
              onClick={onBackToLanding}
              className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded border border-slate-200 hover:border-slate-300"
              title="返回首页，重新选择数据来源"
            >
              ← 返回首页
            </button>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 hidden sm:inline">视角</span>
            <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => onViewChange('patient')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  view === 'patient'
                    ? 'bg-white shadow-sm text-slate-900'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                病人视角
              </button>
              <button
                onClick={() => onViewChange('doctor')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  view === 'doctor'
                    ? 'bg-white shadow-sm text-slate-900'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                医生视角
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
