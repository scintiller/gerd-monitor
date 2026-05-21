import type { RefluxEvent, RefluxType, Severity, Summary } from './types';

// 类型 → 中文 + 颜色
export const TYPE_LABEL: Record<RefluxType, string> = {
  acid: '酸反流',
  weakly_acidic: '弱酸反流',
  non_acid_bolus: '非酸反流',
  weakly_alkaline: '弱碱反流',
};

export const TYPE_PATIENT_LABEL: Record<RefluxType, string> = {
  acid: '强酸反流',
  weakly_acidic: '弱酸反流',
  non_acid_bolus: '非酸反流',
  weakly_alkaline: '弱碱反流',
};

export const TYPE_COLOR: Record<RefluxType, string> = {
  acid: '#dc2626',          // 红色 - 强酸（危险）
  weakly_acidic: '#eab308', // 琥珀黄 - 弱酸（提示），明显区别于红色
  non_acid_bolus: '#0284c7',// 蓝色 - 非酸（中性）
  weakly_alkaline: '#7c3aed',// 紫色 - 弱碱（少见）
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  mild: '轻度',
  moderate: '中度',
  severe: '重度',
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  mild: '#16a34a',
  moderate: '#ea580c',
  severe: '#dc2626',
};

// 把秒数（自录制开始）转为 HH:MM:SS（假设录制从 00:00:00 开始）
export function fmtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtDuration(s: number): string {
  if (s < 60) return `${s.toFixed(1)} 秒`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rem = Math.round(s - m * 60);
    return rem ? `${m} 分 ${rem} 秒` : `${m} 分钟`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s - h * 3600) / 60);
  return `${h} 小时 ${m} 分`;
}

// 病人友好版：为什么这是一次反流
export function explainWhy(ev: RefluxEvent): string {
  const cm = ev.proximal_extent_cm;
  return `这次事件被识别为一次反流，是因为食道下端的阻抗（电流通过组织的阻力）突然下降到了原来的不到一半——这说明有一团液体通过了。更关键的是，下降是「从下往上」依次出现的（食道下端先变化，再到上端），这正是反流的方向（胃→食道），而吞咽时方向是反过来的。这次反流上升到了距离胃约 ${cm} 厘米的高度。`;
}

// 病人友好版：这次反流有多严重
export function explainSeverity(ev: RefluxEvent): string {
  const parts: string[] = [];
  // 时长
  if (ev.duration_s < 30) {
    parts.push(`持续 ${fmtDuration(ev.duration_s)}（较短，食道清除较快）`);
  } else if (ev.duration_s < 120) {
    parts.push(`持续 ${fmtDuration(ev.duration_s)}（中等时长）`);
  } else if (ev.duration_s < 300) {
    parts.push(`持续 ${fmtDuration(ev.duration_s)}（偏长，食道清除较慢）`);
  } else {
    parts.push(`持续 ${fmtDuration(ev.duration_s)}（超长，提示食道清除能力受损，常见于食管裂孔疝）`);
  }
  // pH
  if (ev.ph_nadir < 2) {
    parts.push(`pH 最低降到 ${ev.ph_nadir}（强酸，相当于柠檬汁，对粘膜刺激较大）`);
  } else if (ev.ph_nadir < 4) {
    parts.push(`pH 最低降到 ${ev.ph_nadir}（达到酸反流标准）`);
  } else if (ev.ph_nadir < 5.5) {
    parts.push(`pH 最低降到 ${ev.ph_nadir}（轻度偏酸，胃酸已被稀释）`);
  } else {
    parts.push(`pH 保持在 ${ev.ph_nadir} 附近（无明显酸性）`);
  }
  // 近端高度
  if (ev.proximal_extent_cm >= 15) {
    parts.push('反流到达 ≥15 cm 高度，已达到咽喉附近，可能引起咳嗽、声嘶、咽部异物感等食管外症状');
  } else if (ev.proximal_extent_cm >= 9) {
    parts.push(`反流到达约 ${ev.proximal_extent_cm} cm（食道中段）`);
  } else {
    parts.push(`反流仅累及食道下端（${ev.proximal_extent_cm} cm 以内）`);
  }
  return parts.join('；');
}

// 病人友好版：怎么办
export function explainWhatToDo(ev: RefluxEvent): string {
  if (ev.severity === 'severe' || ev.is_long) {
    return '这是一次较严重的反流。如果这种事件经常发生（一天 >5 次或频繁影响睡眠），建议就医评估，可能需要 PPI 类抑酸药、调整饮食（避免高脂、辛辣、咖啡、酒精、夜宵）、抬高床头睡眠。若同时有食管裂孔疝且药物治疗效果差，可考虑抗反流手术（如腹腔镜胃底折叠术）。';
  }
  if (ev.severity === 'moderate') {
    return '中度反流。生活方式调整很有帮助：少食多餐、餐后避免立即平躺、控制体重、戒烟限酒、避免诱发食物（巧克力、薄荷、酸性饮料等）。如症状频繁可短期使用抑酸药。';
  }
  return '这是一次轻度反流，通常不会引起明显症状或损伤。健康人每天也会发生少量反流（被认为是正常生理现象）。';
}

// 三种反流类型的「百科条目」（病人友好版）
export const TYPE_PROFILE: Record<RefluxType, {
  ph: string;
  analogy: string;
  cause: string;
  symptoms: string;
  damage: string;
  whenToWorry: string;
}> = {
  acid: {
    ph: 'pH < 4',
    analogy: '相当于直接接触柠檬汁、醋的酸度',
    cause: '空腹时胃酸被反流到食道。胃酸的本质是稀盐酸（pH 1–2），即使被反流过程稍微稀释，仍能维持强酸性。',
    symptoms: '典型「烧心」（胸骨后灼热）、反酸到嘴里、胸痛（可能误以为心脏病）',
    damage: '直接腐蚀食管粘膜：糜烂性食管炎、出血、长期可发展为巴雷特食管（癌前病变）、食管狭窄',
    whenToWorry: '一天 >5 次，或一次持续 >5 分钟，或 24h 酸暴露时间 >6%',
  },
  weakly_acidic: {
    ph: 'pH 4–7',
    analogy: '相当于接触咖啡、番茄汁的酸度（弱酸到接近中性）',
    cause: '胃里的内容物被反流，但酸性已被稀释——常见于：刚吃过饭（食物中和酸）、服用抑酸药（PPI 类药物如奥美拉唑）、餐后大量饮水、唾液中和。',
    symptoms: '可能完全没感觉（健康人也常有）；也可能有：反食（食物回到嘴里）、咽部异物感、慢性咳嗽、夜间被呛醒、声音嘶哑',
    damage: '不会腐蚀食管粘膜（pH 不够低），但反复刺激会引起：粘膜屏障下降（MNBI 降低）、神经敏感性增高、PPI 治疗后仍有症状',
    whenToWorry: '本身一天 30–50 次可能算正常；但如果伴随明显症状、或在 PPI 治疗期间发生，提示「PPI 抵抗」或非典型反流',
  },
  non_acid_bolus: {
    ph: 'pH 4–7（事件中未明显变酸）',
    analogy: '相当于水、果汁的酸度——主要是液体或气体上涌',
    cause: '常见于：餐后胃排空过程中、夜间长时间空腹（胃内已无大量酸）、抑酸药完全起效时',
    symptoms: '嗳气、腹胀、反食（食物味）、咽部异物感；通常没有「烧心」感觉',
    damage: '不损伤粘膜，但频繁发生说明胃食管交界处「抗反流屏障」失效（常见于食管裂孔疝）',
    whenToWorry: '一天 >20 次提示 LES 功能差或食管裂孔疝；如果同时有明显症状需就医',
  },
  weakly_alkaline: {
    ph: 'pH > 7',
    analogy: '碱性反流——可能含十二指肠液或胆汁',
    cause: '十二指肠内容物（胆汁、胰液、肠液）反流到胃，再到食道。常见于胃部手术后、严重胃食管反流伴胃排空异常',
    symptoms: '口苦（特别是夜间或晨起）、上腹烧灼感（与酸反流的胸骨后不同）、口臭、嗳气苦味',
    damage: '胆汁酸对食管粘膜也有损伤作用，且 PPI 抑酸药对此无效；与巴雷特食管和食管腺癌相关',
    whenToWorry: '如有口苦、胆汁反流症状应就医评估',
  },
};

// 这次反流"意味着什么"：基于事件特征生成针对性解释
export function explainImpact(ev: RefluxEvent): {
  feelings: string;
  health: string;
  context: string;
} {
  const feelings: string[] = [];
  const health: string[] = [];

  // 基于类型
  if (ev.type === 'acid') {
    feelings.push('烧心（胸骨后灼热感）、反酸到嘴里');
    health.push('强酸直接接触食道，对粘膜有刺激/腐蚀作用');
  } else if (ev.type === 'weakly_acidic') {
    if (ev.ph_nadir < 5.5) {
      feelings.push('轻微烧心或胸骨后不适');
    } else {
      feelings.push('可能没有明显感觉（pH 接近中性）');
    }
    health.push('不腐蚀粘膜，但反复发生会让食管对刺激更敏感');
  } else if (ev.type === 'non_acid_bolus') {
    feelings.push('嗳气、反食或喉部异物感（无烧心）');
    health.push('物理性反流，不损伤粘膜，但提示抗反流屏障功能下降');
  } else {
    feelings.push('口苦、晨起苦味');
    health.push('胆汁/碱性物质，PPI 抑酸药无效，与长期粘膜病变相关');
  }

  // 基于近端高度
  if (ev.proximal_extent_cm >= 15) {
    feelings.push('反流到达喉部——咳嗽、声音嘶哑、咽部异物感、夜间被呛醒');
    health.push('可能引起慢性咽炎、声带损伤、哮喘样症状、夜间反食呛咳');
  } else if (ev.proximal_extent_cm >= 9) {
    feelings.push('反流到食道中段——胸骨中部不适');
  } else {
    // 仅食道下段：症状轻微
  }

  // 基于时长
  if (ev.duration_s > 300) {
    feelings.push('长时间感觉持续不退（>5 分钟）');
    health.push('超长反流提示食管「自清能力」受损（蠕动差或食管裂孔疝），是反流病的高风险信号');
  } else if (ev.duration_s > 60) {
    health.push('持续 >1 分钟，食管清除偏慢');
  }

  // 在总体中的位置
  let context = '';
  if (ev.severity === 'severe') {
    context = '这次反流在严重度评分上属于「重度」，是值得重点关注的事件。';
  } else if (ev.severity === 'moderate') {
    context = '中等严重度。单次不会造成大问题，但如果同类反流频繁，需要在意。';
  } else {
    context = '轻微反流。健康人每天也会有少量类似事件，多数情况下无症状无影响。';
  }

  return {
    feelings: feelings.join('；'),
    health: health.join('；'),
    context,
  };
}

// 病人视角的诊断结论
export function patientDiagnosis(s: Summary): { headline: string; body: string; tone: 'good' | 'mild' | 'concern' } {
  if (s.diagnosis_level === 'normal' && s.total_reflux_episodes <= 40) {
    return {
      headline: '好消息：24 小时酸反流监测在正常范围内',
      body: `你的胃酸暴露时间是 ${s.aet_percent}%（健康人通常 <4%），明显低于诊断「胃食管反流病」的门槛（6%）。这说明在测试期间，你的食管整体上没有受到过多胃酸的浸泡。`,
      tone: 'good',
    };
  }
  if (s.diagnosis_level === 'normal') {
    return {
      headline: '酸暴露时间正常，但反流次数偏多',
      body: `胃酸暴露时间 ${s.aet_percent}%（正常 <4%），但 24 小时内发生了 ${s.total_reflux_episodes} 次反流事件，多数为弱酸性（pH 4–7）。这种情况在服用抑酸药（PPI）的患者或非酸反流为主的患者中常见，需要医生结合症状综合判断。`,
      tone: 'mild',
    };
  }
  if (s.diagnosis_level === 'inconclusive') {
    return {
      headline: '处于「灰区」，需要结合其他证据综合判断',
      body: `胃酸暴露时间 ${s.aet_percent}% 在灰区（4–6%）。这种情况国际指南建议结合症状关联、远端粘膜阻抗等辅助证据综合判断。需要专科医生进一步评估。`,
      tone: 'mild',
    };
  }
  return {
    headline: '检测到明确的病理性胃食管反流',
    body: `胃酸暴露时间 ${s.aet_percent}%，超过了 6% 的阈值，符合胃食管反流病（GERD）的诊断标准。建议尽快就医评估治疗方案。`,
    tone: 'concern',
  };
}
