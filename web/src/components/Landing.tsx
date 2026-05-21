import { useRef, useState } from 'react';
import type { AnalyzeStatus } from '../analyzer/useAnalyzer';

interface Props {
  onChooseSample: () => void;
  onUpload: (file: File) => void;
  status: AnalyzeStatus;
  onReset: () => void;
}

export function Landing({ onChooseSample, onUpload, status, onReset }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const isWorking = status.kind === 'parsing' || status.kind === 'analyzing';

  function handlePick() {
    fileInputRef.current?.click();
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('请选择 .csv 文件（Sandhill 13 通道格式）');
      return;
    }
    onUpload(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-slate-900 mb-2">24 小时食管阻抗-pH 监测分析</h1>
          <p className="text-slate-600 text-sm leading-relaxed max-w-xl mx-auto">
            上传你的 24 小时阻抗-pH 监测原始 CSV，自动按 Lyon Consensus 2.0 + Porto Consensus 检测反流事件，
            病人/医生两种视角呈现。<br />
            <span className="text-slate-500">数据完全在你的浏览器里处理，不会上传到任何服务器。</span>
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 上传 */}
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            className={`bg-white rounded-lg shadow-sm border-2 ${
              dragOver ? 'border-blue-500 bg-blue-50' : 'border-dashed border-slate-300'
            } p-6 transition`}
          >
            <div className="text-center">
              <div className="text-4xl mb-3">📤</div>
              <h2 className="text-lg font-medium text-slate-900 mb-1">分析我自己的数据</h2>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                上传 Sandhill 13 通道格式的 CSV<br />
                （通常医院会刻成光盘给你，原始 CSV 大约 500 MB）
              </p>
              <button
                onClick={handlePick}
                disabled={isWorking}
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {isWorking ? '正在处理…' : '选择 CSV 文件'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <div className="mt-3 text-[11px] text-slate-400">或拖拽 CSV 到这里</div>
            </div>
          </div>

          {/* 样例 */}
          <button
            onClick={onChooseSample}
            disabled={isWorking}
            className="bg-white rounded-lg shadow-sm border-2 border-slate-200 p-6 text-center hover:border-emerald-400 hover:bg-emerald-50/50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <div className="text-4xl mb-3">👀</div>
            <h2 className="text-lg font-medium text-slate-900 mb-1">先看一下样例</h2>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              用一份已匿名化的真实病例数据演示<br />
              （病例 001，23.76 小时记录，32 个反流事件）
            </p>
            <div className="inline-block px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium">
              查看样例
            </div>
          </button>
        </div>

        {/* 进度 */}
        {isWorking && (
          <div className="mt-6 bg-white rounded-lg shadow-sm border border-slate-200 p-4">
            <ProgressView status={status} />
            <button
              onClick={onReset}
              className="mt-3 text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2"
            >
              取消
            </button>
          </div>
        )}

        {status.kind === 'error' && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
            <div className="font-medium">解析失败</div>
            <div className="mt-1">{status.message}</div>
            <button
              onClick={onReset}
              className="mt-2 text-xs text-red-700 hover:text-red-900 underline underline-offset-2"
            >
              返回重试
            </button>
          </div>
        )}

        <div className="mt-8 text-center text-xs text-slate-400 leading-relaxed">
          支持的 CSV 格式：Sandhill BioVIEW / Diversatek ZAN-BR-44 导出（13 列：pH8, Imp11/Base24, Imp12/Base26 ... Imp17/Base34）。
          <br />
          基于 <a className="underline hover:text-slate-600" href="https://pubmed.ncbi.nlm.nih.gov/38182428/" target="_blank" rel="noreferrer">Lyon Consensus 2.0 (2024)</a> 与 <a className="underline hover:text-slate-600" href="https://pubmed.ncbi.nlm.nih.gov/28370768/" target="_blank" rel="noreferrer">Porto Consensus</a> 算法。
          仅用于研究和教育，不能替代专业医疗诊断。
        </div>
      </div>
    </div>
  );
}

function ProgressView({ status }: { status: AnalyzeStatus }) {
  if (status.kind === 'parsing') {
    const pct = status.bytesTotal ? (status.bytesRead / status.bytesTotal) * 100 : 0;
    return (
      <div>
        <div className="text-sm text-slate-700 mb-2">
          📂 解析 CSV ... {fmtBytes(status.bytesRead)} / {fmtBytes(status.bytesTotal)} ({pct.toFixed(0)}%)
        </div>
        <div className="h-2 bg-slate-100 rounded overflow-hidden">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-[11px] text-slate-500 mt-2">
          500 MB 文件大约需要 1-2 分钟。数据完全在你的浏览器里处理，不会上传任何服务器。
        </div>
      </div>
    );
  }
  if (status.kind === 'analyzing') {
    return (
      <div>
        <div className="text-sm text-slate-700">
          ⚙️ {status.stage} ...
        </div>
        <div className="h-2 bg-slate-100 rounded overflow-hidden mt-2">
          <div className="h-full bg-blue-500 animate-pulse" style={{ width: '100%' }} />
        </div>
      </div>
    );
  }
  return null;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
