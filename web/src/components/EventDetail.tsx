import type { RefluxEvent, ViewMode } from '../types';
import {
  TYPE_LABEL,
  TYPE_PATIENT_LABEL,
  TYPE_COLOR,
  TYPE_PROFILE,
  SEVERITY_LABEL,
  SEVERITY_COLOR,
  fmtTime,
  fmtDuration,
  explainWhy,
  explainSeverity,
  explainWhatToDo,
  explainImpact,
} from '../explain';

interface Props {
  event: RefluxEvent | null;
  view: ViewMode;
}

export function EventDetail({ event, view }: Props) {
  if (!event) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8 text-center text-slate-500">
        <div className="text-base mb-2">👆 从左侧列表或顶部时间轴选一个反流事件</div>
        <div className="text-sm text-slate-400">每次反流的详情、严重度、为什么、怎么办，都会在这里展示</div>
      </div>
    );
  }

  const typeLabel = view === 'patient' ? TYPE_PATIENT_LABEL[event.type] : TYPE_LABEL[event.type];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-1 self-stretch rounded-full" style={{ background: TYPE_COLOR[event.type] }} />
        <div className="flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-lg font-medium text-slate-900">
              反流事件 #{event.id + 1}
            </h3>
            <span
              className="text-sm px-2 py-0.5 rounded font-medium"
              style={{ background: TYPE_COLOR[event.type] + '20', color: TYPE_COLOR[event.type] }}
            >
              类型：{typeLabel}
            </span>
            <span
              className="text-sm px-2 py-0.5 rounded text-white font-medium"
              style={{ background: SEVERITY_COLOR[event.severity] }}
            >
              严重度：{SEVERITY_LABEL[event.severity]} ({event.severity_score}/100)
            </span>
          </div>
          <div className="text-sm text-slate-500 mt-1 font-mono">
            {fmtTime(event.start_s)} – {fmtTime(event.end_s)}
            <span className="ml-3 text-slate-400">（持续 {fmtDuration(event.duration_s)}）</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5">
            <strong className="text-slate-700">「类型」</strong>是按 pH 高低分类（强酸/弱酸/非酸）；
            <strong className="text-slate-700">「严重度」</strong>是综合时长、到达高度、pH 深度算出的分数（0–100）。
            两者独立——弱酸反流也可能很严重（如果时间长、到达喉部）。
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-500 bg-slate-50 rounded p-2">
        💡 上方时间序列图已自动放大到这次反流，并标出了反流起止、pH 最低点、反流到达的最高位置。
      </div>

      {/* 关键指标卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric label="持续时间" value={fmtDuration(event.duration_s)} />
        <Metric label="pH 谷值" value={String(event.ph_nadir)} hint={event.ph_nadir < 4 ? '酸性' : '弱酸/中性'} />
        <Metric label="近端到达" value={`${event.proximal_extent_cm} cm`} hint={event.proximal_extent_cm >= 15 ? '咽喉部' : event.proximal_extent_cm >= 9 ? '食道中段' : '食道下段'} />
        <Metric label="累及通道" value={`${event.distal_channels_involved} / 6`} />
      </div>

      {/* 严重度分解条 */}
      <SeverityBreakdown event={event} />

      {/* 病人友好版解释 */}
      {view === 'patient' && (
        <>
          {/* 这次反流意味着什么 */}
          <ImpactSection event={event} />

          <Section title="为什么这是一次反流？" tone="info">
            {explainWhy(event)}
          </Section>
          <Section title="有多严重？" tone="warn">
            {explainSeverity(event)}
          </Section>
          <Section title="怎么办？" tone="action">
            {explainWhatToDo(event)}
          </Section>
        </>
      )}

      {/* 医生版：参数与算法依据 */}
      {view === 'doctor' && (
        <>
          <Section title="检测依据 (Porto Consensus)" tone="info">
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>最远端通道 Imp11（3 cm above LES）阻抗下降至基线 50% 以下</li>
              <li>逆向传播：Imp12 下降起点 ≥ Imp11 起点（远端先于近端）</li>
              <li>累及远端 ≥{event.distal_channels_involved} 个阻抗段（共识要求 ≥2）</li>
              <li>持续时间 {fmtDuration(event.duration_s)}（共识要求 ≥5 s）</li>
              <li>pH 谷值 {event.ph_nadir} → 分类为「{TYPE_LABEL[event.type]}」</li>
            </ul>
          </Section>
          <Section title="严重度评分细节" tone="info">
            <div className="text-sm space-y-1">
              <div>综合得分: <strong>{event.severity_score} / 100</strong></div>
              <div className="text-xs text-slate-600">
                = 时长 {Math.min(40, (event.duration_s / 60) * 40).toFixed(1)} 分
                + 近端高度 {((event.proximal_extent_cm - 3) / 14 * 30).toFixed(1)} 分
                + pH 深度 {Math.max(0, (7 - event.ph_nadir) / 7 * 30).toFixed(1)} 分
              </div>
              <div className="text-xs text-slate-500 mt-1">
                分级阈值：&lt;25 轻度 · 25–55 中度 · ≥55 重度
              </div>
            </div>
          </Section>
          {event.notes.length > 0 && (
            <Section title="临床提示" tone="warn">
              <ul className="list-disc list-inside text-sm space-y-1">
                {event.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

// 严重度分解：让用户一眼看出"为什么是重度"
function SeverityBreakdown({ event }: { event: RefluxEvent }) {
  // 与 preprocess.py 的算法保持一致
  const scoreDur = Math.min(40, (event.duration_s / 60) * 40);
  const scoreProx = ((event.proximal_extent_cm - 3) / 14) * 30;
  const scorePh = Math.max(0, ((7 - event.ph_nadir) / 7) * 30);
  const total = Math.round((scoreDur + scoreProx + scorePh) * 10) / 10;

  const severityColor = SEVERITY_COLOR[event.severity];

  // 哪个分量"拉高了"分数？>=80% 满分即视为"高"
  const durHigh = scoreDur >= 40 * 0.8;
  const proxHigh = scoreProx >= 30 * 0.8;
  const phHigh = scorePh >= 30 * 0.8;

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-sm font-medium text-slate-800">
          为什么是「{SEVERITY_LABEL[event.severity]}」？
        </div>
        <div className="text-xs text-slate-500">
          总分 = 时长 + 高度 + pH 三项加权
        </div>
      </div>

      <BreakdownBar
        label="时长"
        value={scoreDur}
        max={40}
        detail={`${fmtDuration(event.duration_s)} → ${scoreDur.toFixed(0)}/40 分`}
        sub={durHigh ? '⚠ 偏长，影响食管清除' : '在可接受范围内'}
        color="#dc2626"
        high={durHigh}
      />
      <BreakdownBar
        label="高度"
        value={scoreProx}
        max={30}
        detail={`反流到达 ${event.proximal_extent_cm} cm → ${scoreProx.toFixed(0)}/30 分`}
        sub={
          event.proximal_extent_cm >= 15
            ? '⚠ 已达咽喉部，可引起食管外症状（咳嗽、声嘶）'
            : event.proximal_extent_cm >= 9
              ? '反流到食道中段'
              : '仅累及食道下段'
        }
        color="#7c3aed"
        high={proxHigh}
      />
      <BreakdownBar
        label="pH 深度"
        value={scorePh}
        max={30}
        detail={`pH 最低 ${event.ph_nadir} → ${scorePh.toFixed(1)}/30 分`}
        sub={
          event.ph_nadir < 4
            ? '⚠ 强酸（对粘膜有刺激）'
            : event.ph_nadir < 5.5
              ? '弱酸性'
              : '接近中性，酸性弱'
        }
        color="#ea580c"
        high={phHigh}
      />

      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
        <div className="text-sm text-slate-700">
          总分
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold" style={{ color: severityColor }}>
            {total.toFixed(1)} / 100
          </span>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded text-white"
            style={{ background: severityColor }}
          >
            {SEVERITY_LABEL[event.severity]}
          </span>
        </div>
      </div>
      <div className="text-[11px] text-slate-500 mt-1">
        分级：&lt;25 轻度 · 25–55 中度 · ≥55 重度
      </div>
    </div>
  );
}

function BreakdownBar({
  label, value, max, detail, sub, color, high,
}: {
  label: string; value: number; max: number; detail: string; sub: string; color: string; high: boolean;
}) {
  const pct = (value / max) * 100;
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-baseline justify-between text-xs mb-0.5">
        <span className={`font-medium ${high ? 'text-slate-900' : 'text-slate-600'}`}>
          {label}
          {high && <span className="ml-1 text-amber-600">●</span>}
        </span>
        <span className="text-slate-500 font-mono">{detail}</span>
      </div>
      <div className="relative h-3 bg-slate-100 rounded overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full rounded transition-all"
          style={{ width: `${pct}%`, background: color, opacity: high ? 1 : 0.55 }}
        />
      </div>
      <div className={`text-[11px] mt-0.5 ${high ? 'text-amber-700' : 'text-slate-500'}`}>{sub}</div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-slate-50 rounded p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-base font-medium text-slate-900 mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

// 「这次反流意味着什么」: 类型背景 + 这次的具体影响
function ImpactSection({ event }: { event: RefluxEvent }) {
  const profile = TYPE_PROFILE[event.type];
  const impact = explainImpact(event);
  const color = TYPE_COLOR[event.type];

  return (
    <div className="border rounded-lg overflow-hidden" style={{ borderColor: color + '60' }}>
      <div className="px-3 py-2 text-white text-sm font-medium" style={{ background: color }}>
        这次反流意味着什么？
      </div>
      <div className="p-3 space-y-3">
        {/* 类型科普（折叠展开） */}
        <details className="group">
          <summary className="cursor-pointer text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1">
            <span className="text-slate-400 group-open:rotate-90 inline-block transition">▸</span>
            先了解一下：什么是「{TYPE_PATIENT_LABEL[event.type]}」？
          </summary>
          <div className="mt-2 ml-4 text-xs text-slate-700 leading-relaxed space-y-1.5">
            <div><strong>酸度：</strong>{profile.ph}（{profile.analogy}）</div>
            <div><strong>怎么来的：</strong>{profile.cause}</div>
            <div><strong>典型症状：</strong>{profile.symptoms}</div>
            <div><strong>对身体的影响：</strong>{profile.damage}</div>
          </div>
        </details>

        {/* 这次事件的具体影响 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <ImpactCard
            icon="😣"
            title="你可能感觉到"
            text={impact.feelings || '可能没有明显感觉'}
            tone="warn"
          />
          <ImpactCard
            icon="🩺"
            title="对食管/身体的影响"
            text={impact.health || '无明显影响'}
            tone="info"
          />
          <ImpactCard
            icon="📊"
            title="放在你 24h 总体里看"
            text={impact.context}
            tone="neutral"
          />
        </div>
      </div>
    </div>
  );
}

function ImpactCard({ icon, title, text, tone }: { icon: string; title: string; text: string; tone: 'info' | 'warn' | 'neutral' }) {
  const bg = {
    info: 'bg-blue-50 border-blue-100',
    warn: 'bg-amber-50 border-amber-100',
    neutral: 'bg-slate-50 border-slate-100',
  }[tone];
  return (
    <div className={`rounded p-2.5 border ${bg}`}>
      <div className="text-xs font-medium text-slate-700 mb-1">{icon} {title}</div>
      <div className="text-xs text-slate-700 leading-relaxed">{text}</div>
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone: 'info' | 'warn' | 'action'; children: React.ReactNode }) {
  const colors = {
    info: 'bg-blue-50 border-blue-200 text-blue-900',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
    action: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  };
  return (
    <div className={`border rounded-lg p-3 ${colors[tone]}`}>
      <div className="text-sm font-medium mb-1">{title}</div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}
