import type { RefluxType, Summary, ViewMode } from '../types';
import { patientDiagnosis, TYPE_PATIENT_LABEL, TYPE_COLOR, TYPE_PROFILE } from '../explain';

interface Props {
  summary: Summary;
  view: ViewMode;
}

export function SummaryPanel({ summary, view }: Props) {
  if (view === 'patient') return <PatientSummary summary={summary} />;
  return <DoctorSummary summary={summary} />;
}

function PatientSummary({ summary }: { summary: Summary }) {
  const dx = patientDiagnosis(summary);
  const toneClass = {
    good: 'bg-emerald-50 border-emerald-200',
    mild: 'bg-amber-50 border-amber-200',
    concern: 'bg-red-50 border-red-200',
  }[dx.tone];
  const toneText = {
    good: 'text-emerald-900',
    mild: 'text-amber-900',
    concern: 'text-red-900',
  }[dx.tone];

  return (
    <div className="space-y-3">
      <div className={`rounded-lg border p-4 ${toneClass}`}>
        <div className={`text-lg font-medium ${toneText}`}>{dx.headline}</div>
        <p className={`text-sm mt-1.5 leading-relaxed ${toneText}`}>{dx.body}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BigStat
          label="酸接触时间"
          value={`${summary.aet_percent}%`}
          sub={`24 小时里食道是「酸性环境」的占比`}
          tone={summary.aet_percent < 4 ? 'good' : summary.aet_percent < 6 ? 'mild' : 'concern'}
          benchmark={`正常 <4% · 异常 >6%`}
        />
        <BigStat
          label="反流总次数"
          value={`${summary.total_reflux_episodes}`}
          sub="24 小时内胃里的东西冲上食道的次数"
          tone={summary.total_reflux_episodes < 40 ? 'good' : summary.total_reflux_episodes < 80 ? 'mild' : 'concern'}
          benchmark="一般 <40 次/天"
        />
        <BigStat
          label="强酸反流"
          value={`${summary.acid_episodes}`}
          sub="pH<4 的反流次数（刺激性最强）"
          tone={summary.acid_episodes < 10 ? 'good' : summary.acid_episodes < 50 ? 'mild' : 'concern'}
          benchmark=""
        />
        <BigStat
          label="食管粘膜屏障"
          value={`${summary.mnbi_distal_mean} Ω`}
          sub="夜间基线阻抗（MNBI），越高越完整"
          tone={summary.mnbi_distal_mean > 2000 ? 'good' : summary.mnbi_distal_mean > 1500 ? 'mild' : 'concern'}
          benchmark="正常 >1500 Ω"
        />
      </div>

      {/* 反流次数分布的可视化 */}
      <RefluxBreakdown summary={summary} />

      {/* 三种反流类型对比卡 */}
      <TypesComparison />

      {/* Q&A 解答常见困惑 */}
      <FAQCard summary={summary} />

      {/* 测试方法说明 */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
        <div className="text-sm font-medium text-slate-700 mb-2">什么是 24 小时阻抗-pH 监测？</div>
        <p className="text-sm text-slate-600 leading-relaxed">
          医生在你食道里放了一根细管，上面有 6 个探测器（阻抗）和 1 个酸度感应器（pH）。
          这些探测器从胃的入口往上一路排列，能 24 小时记录食道里发生的每一件事——
          什么时候有液体经过、是从下往上（反流）还是从上往下（吞咽）、有多酸、停留了多久。
          这是诊断「胃食管反流病」最准确的方法。
        </p>
      </div>
    </div>
  );
}

function RefluxBreakdown({ summary }: { summary: Summary }) {
  const total = summary.total_reflux_episodes || 1;
  const segments: { type: RefluxType; n: number; pct: number }[] = [
    { type: 'acid', n: summary.acid_episodes, pct: (summary.acid_episodes / total) * 100 },
    { type: 'weakly_acidic', n: summary.weakly_acidic_episodes, pct: (summary.weakly_acidic_episodes / total) * 100 },
    { type: 'non_acid_bolus', n: summary.non_acid_episodes, pct: (summary.non_acid_episodes / total) * 100 },
  ];
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
      <div className="text-sm font-medium text-slate-700 mb-1">你的 {summary.total_reflux_episodes} 次反流是什么样的？</div>
      <div className="text-xs text-slate-500 mb-3">注意：不是所有反流都「一样严重」——重要的是有多少是真正的「强酸」反流</div>
      <div className="flex h-8 rounded overflow-hidden border border-slate-200">
        {segments.map((seg) => seg.n > 0 && (
          <div
            key={seg.type}
            className="flex items-center justify-center text-white text-xs font-medium"
            style={{ background: TYPE_COLOR[seg.type], width: `${seg.pct}%`, minWidth: 28 }}
            title={`${TYPE_PATIENT_LABEL[seg.type]}: ${seg.n} 次`}
          >
            {seg.n}
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        {segments.map((seg) => (
          <div key={seg.type} className="flex items-start gap-2 p-2 rounded bg-slate-50">
            <span className="inline-block w-3 h-3 rounded-sm mt-0.5 flex-shrink-0" style={{ background: TYPE_COLOR[seg.type] }} />
            <div>
              <div className="font-medium text-slate-800">
                {seg.n} 次 {TYPE_PATIENT_LABEL[seg.type]}
                <span className="text-slate-400 ml-1">({TYPE_PROFILE[seg.type].ph})</span>
              </div>
              <div className="text-slate-600 mt-0.5 leading-snug">{TYPE_PROFILE[seg.type].analogy}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TypesComparison() {
  const order: RefluxType[] = ['acid', 'weakly_acidic', 'non_acid_bolus'];
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
      <div className="text-sm font-medium text-slate-700 mb-1">三种反流类型，到底有什么不同？</div>
      <div className="text-xs text-slate-500 mb-3">同样是"胃里的东西冲上来"，但酸性不同，对身体的影响也完全不同</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {order.map((t) => {
          const p = TYPE_PROFILE[t];
          const color = TYPE_COLOR[t];
          return (
            <div key={t} className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 text-white text-sm font-medium" style={{ background: color }}>
                {TYPE_PATIENT_LABEL[t]}
                <span className="ml-2 text-white/80 text-xs font-normal">{p.ph}</span>
              </div>
              <div className="p-3 space-y-2 text-xs leading-relaxed">
                <Field label="🍋 大致酸度" text={p.analogy} />
                <Field label="🌀 怎么产生" text={p.cause} />
                <Field label="😣 可能的症状" text={p.symptoms} />
                <Field label="🩺 健康影响" text={p.damage} />
                <Field label="⚠️ 什么时候要担心" text={p.whenToWorry} highlight />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, text, highlight }: { label: string; text: string; highlight?: boolean }) {
  return (
    <div>
      <div className={`text-[11px] font-medium ${highlight ? 'text-amber-700' : 'text-slate-500'}`}>{label}</div>
      <div className={`mt-0.5 ${highlight ? 'text-slate-800' : 'text-slate-600'}`}>{text}</div>
    </div>
  );
}

function FAQCard({ summary }: { summary: Summary }) {
  const acid = summary.acid_episodes;
  const weak = summary.weakly_acidic_episodes;
  const non = summary.non_acid_episodes;
  const total = summary.total_reflux_episodes;
  return (
    <div className="bg-amber-50/50 border border-amber-200 rounded-lg p-4 space-y-3">
      <div className="text-sm font-medium text-amber-900">❓ 你可能会问</div>

      <FAQ
        q={`我有 ${total} 次反流，但报告说"正常范围"，到底正常不正常？`}
        a={
          <>
            <p>
              <strong>诊断 GERD 看的是「酸暴露时间（AET）」，不是反流次数。</strong>
              AET = 一天里食道处于酸性（pH&lt;4）状态的总时长占比。
              国际指南（Lyon Consensus 2.0）规定：AET &gt; 6% 才算病理性反流，
              你的 AET 是 <strong>{summary.aet_percent}%</strong>，远在正常范围内。
            </p>
            <p className="mt-2">
              你有 {total} 次反流是没错，但其中{' '}
              {acid > 0 ? <>只有 <strong>{acid} 次</strong> 是 pH&lt;4 的<span style={{ color: TYPE_COLOR.acid }}>强酸反流</span>，</> : <>0 次是强酸反流，</>}
              {' '}另外 <strong>{weak} 次是<span style={{ color: TYPE_COLOR.weakly_acidic }}>弱酸反流</span></strong>
              {non > 0 && <>，<strong>{non} 次<span style={{ color: TYPE_COLOR.non_acid_bolus }}>非酸反流</span></strong></>}。
              <strong>健康人 24h 通常也有 30–50 次类似反流</strong>，是正常生理现象。
            </p>
          </>
        }
      />

      <FAQ
        q="既然不损伤食管，为什么还要测「弱酸反流」？它跟我有什么关系？"
        a={
          <>
            <p>
              虽然弱酸（pH 4–7）不会腐蚀食管粘膜，但它依然「物理性地冲上来」，可能引起：
            </p>
            <ul className="mt-1.5 list-disc list-inside space-y-0.5">
              <li>反食、咽部异物感、慢性咳嗽、夜间被呛醒、声音嘶哑（即使没有典型烧心）</li>
              <li>正在服 PPI（如奥美拉唑）的人「吃了药仍有症状」——常常是弱酸/非酸反流没被抑制</li>
              <li>食管裂孔疝患者：弱酸反流频繁说明胃食管交界处的「单向阀」（贲门）已不严密</li>
              <li>帮医生判断：你的症状到底是真的来自反流，还是食管对正常反流过度敏感（功能性食管疾病）</li>
            </ul>
            <p className="mt-2 text-slate-700">
              简单说：<strong>AET 测「酸暴露」严重不严重，反流次数测「抗反流屏障」好不好。两个角度都重要。</strong>
            </p>
          </>
        }
      />

      <FAQ
        q="我应该怎么做？"
        a={
          <>
            <p>
              基于你这次的结果（AET 正常 + 弱酸反流偏多）：
            </p>
            <ul className="mt-1.5 list-disc list-inside space-y-0.5">
              <li>如果<strong>没有症状</strong>：这是正常生理现象，不需要治疗</li>
              <li>如果<strong>有症状但已在服 PPI</strong>：弱酸反流可能是症状原因，可与医生讨论加用促动力药、海藻酸盐（如盖胃平）覆盖反流</li>
              <li>如果<strong>有食管裂孔疝</strong>+ 频繁弱酸反流：药物效果不佳时可考虑抗反流手术（如腹腔镜胃底折叠术、LINX）</li>
              <li>共性建议：避免餐后立即平躺、抬高床头 15 cm、控制体重、戒烟限酒、避免诱发食物（巧克力、薄荷、咖啡、酒精、辛辣、酸性饮料）</li>
            </ul>
          </>
        }
      />
    </div>
  );
}

function FAQ({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm font-medium text-slate-800 hover:text-amber-900 flex items-start gap-2">
        <span className="text-amber-700 mt-0.5">▸</span>
        <span className="group-open:hidden">{q}</span>
        <span className="hidden group-open:inline">{q}</span>
      </summary>
      <div className="mt-2 ml-5 text-sm text-slate-700 leading-relaxed">{a}</div>
    </details>
  );
}

function DoctorSummary({ summary }: { summary: Summary }) {
  const dxColor = {
    conclusive: 'bg-red-50 border-red-300 text-red-900',
    normal: 'bg-emerald-50 border-emerald-300 text-emerald-900',
    inconclusive: 'bg-amber-50 border-amber-300 text-amber-900',
  }[summary.diagnosis_level];

  return (
    <div className="space-y-3">
      <div className={`rounded-lg border p-4 ${dxColor}`}>
        <div className="text-xs uppercase tracking-wide opacity-70">诊断结论 · Lyon Consensus 2.0</div>
        <div className="text-lg font-medium mt-0.5">{summary.diagnosis}</div>
        {summary.supportive_evidence.length > 0 && (
          <div className="mt-2 text-sm">
            <div className="font-medium opacity-80">辅助证据：</div>
            <ul className="list-disc list-inside text-sm mt-0.5">
              {summary.supportive_evidence.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <DocStat label="AET (酸暴露时间)" value={`${summary.aet_percent}%`} hint="正常 <4% · 异常 >6% · 灰区 4–6%" />
        <DocStat label="反流总次数" value={`${summary.total_reflux_episodes}`} hint="辅助证据阈值 >80/天" />
        <DocStat label="酸 / 弱酸 / 非酸"
          value={`${summary.acid_episodes} / ${summary.weakly_acidic_episodes} / ${summary.non_acid_episodes}`} />
        <DocStat label="最长酸反流" value={`${summary.longest_acid_episode_s.toFixed(0)} s`}
          hint={summary.long_episodes_over_5min ? `${summary.long_episodes_over_5min} 次 >5min` : '无超长反流'} />
        <DocStat label="远端 MNBI (均值)" value={`${summary.mnbi_distal_mean} Ω`} hint="异常阈 <1500 Ω" />
        <DocStat label="记录时长" value={`${summary.recording_duration_h} h`} />
        <DocStat label="采样率" value={`${summary.sample_rate_hz} Hz`} />
        <DocStat label="阻抗通道分布" value="3·5·7·9·15·17 cm" hint="LES 上方距离" />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 text-sm leading-relaxed">
        <div className="text-sm font-medium text-slate-700 mb-1">通道 MNBI 详情</div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-2">
          {Object.entries(summary.mnbi_per_channel).map(([ch, v]) => (
            <div key={ch} className="bg-slate-50 rounded p-2 text-center">
              <div className="text-[11px] text-slate-500">{ch} ({summary.channel_positions_cm[ch]}cm)</div>
              <div className="font-mono text-sm text-slate-900 mt-0.5">{v} Ω</div>
            </div>
          ))}
        </div>
        <div className="text-xs text-slate-500 mt-3">
          MNBI 计算：在整段记录中找出阻抗最稳定（标准差最小）的 10 分钟窗口，取其中位数。
          这是反映食管粘膜完整性的代理指标——长期酸暴露会破坏紧密连接，导致 MNBI 下降。
        </div>
      </div>
    </div>
  );
}

function BigStat({
  label, value, sub, tone, benchmark,
}: {
  label: string; value: string; sub: string; tone: 'good' | 'mild' | 'concern'; benchmark: string;
}) {
  const colors = {
    good: 'border-emerald-200 bg-emerald-50',
    mild: 'border-amber-200 bg-amber-50',
    concern: 'border-red-200 bg-red-50',
  }[tone];
  return (
    <div className={`rounded-lg border ${colors} p-3`}>
      <div className="text-xs text-slate-600">{label}</div>
      <div className="text-2xl font-medium text-slate-900 mt-1">{value}</div>
      <div className="text-xs text-slate-600 mt-1 leading-snug">{sub}</div>
      {benchmark && <div className="text-[10px] text-slate-500 mt-1">{benchmark}</div>}
    </div>
  );
}

function DocStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded border border-slate-200 p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-base font-medium text-slate-900 mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}
