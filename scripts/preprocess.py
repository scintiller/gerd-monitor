"""
24小时食管阻抗-pH监测数据预处理与反流事件自动检测

算法依据：
  - Lyon Consensus 2.0 (2024): AET >6% 病理性反流，<4% 排除 GERD，4-6% 灰区
  - Porto Consensus / 国际共识：阻抗反流事件 = 远端阻抗较基线下降 ≥50%，
    自远端向近端逆向传播，至少累及最远端 2 个阻抗段，持续 ≥5 秒
  - 酸反流：pH 从 >4 降至 <4 并持续 ≥5 秒
  - 弱酸反流：阻抗反流事件 + pH 谷值 ≥4 (持续未跌破4)
  - 弱碱反流：阻抗反流事件 + pH 始终 >7

输出：
  data/processed/overview.json          1Hz 总览（24h，约 86k 点/通道）
  data/processed/events.json            所有反流事件 + 标注
  data/processed/summary.json           全局指标
  data/processed/zoom/event_<i>.json    每个事件 ±30s 的 50Hz 高清数据
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW_CSV = ROOT / "001.csv"
OUT_DIR = ROOT / "data" / "processed"
ZOOM_DIR = OUT_DIR / "zoom"

SAMPLE_RATE = 50.0  # Hz（文件已统一上采样到 50Hz）

# Sandhill/Diversatek 6 通道阻抗-pH 导管标准位置（cm above LES）
# 根据 CSV 列顺序 Imp11→17 自远端向近端
CHANNEL_POSITIONS_CM = {
    "Imp11": 3,
    "Imp12": 5,
    "Imp13": 7,
    "Imp14": 9,
    "Imp16": 15,
    "Imp17": 17,
}
IMP_CHANNELS = list(CHANNEL_POSITIONS_CM.keys())  # 远端→近端
PH_CHANNEL = "pH8"

# Lyon Consensus 2.0 / Porto Consensus 阈值
ACID_PH = 4.0
IMP_DROP_RATIO = 0.50          # 50% baseline drop
MIN_DURATION_S = 4.0           # 阻抗事件最短持续时间（共识为 5s，临床常用 4–5s）
MIN_DISTAL_CHANNELS = 2        # 至少累及远端 2 个阻抗段
RETROGRADE_LAG_S = 0.1         # 通道间允许的最小逆向传播延迟（≥0 表示逆向）
EVENT_GAP_S = 5.0              # 两个事件合并的间隙阈值
BASELINE_WIN_S = 60 * 5        # 阻抗基线滑动窗口（5 分钟中位数）


@dataclass
class RefluxEvent:
    id: int
    start_s: float
    end_s: float
    duration_s: float
    type: str                  # acid | weakly_acidic | weakly_alkaline | non_acid_bolus
    ph_nadir: float
    ph_at_start: float
    proximal_extent_cm: int    # 最高到达 cm
    proximal_channel: str
    distal_channels_involved: int
    severity: str              # mild | moderate | severe
    severity_score: float      # 0–100
    is_long: bool              # >5 分钟
    notes: list[str]


def parse_csv(path: Path) -> tuple[dict, pd.DataFrame]:
    """读取头部 + 数据。CSV 用 GBK 头 + ASCII 数据。"""
    print(f"读取 {path.name} ...")
    with open(path, "rb") as f:
        header_bytes = b""
        for _ in range(6):
            header_bytes += f.readline()
    header_lines = header_bytes.decode("gbk", errors="replace").splitlines()
    meta = {
        "name_raw": header_lines[0],
        "channels": int(header_lines[1].split(",")[1]),
        "sf_per_channel": [float(x) for x in header_lines[2].split(",")[1:]],
        "types": [x.strip() for x in header_lines[3].split(",")[1:]],
        "sf_file": float(header_lines[4].split(",")[1]),
    }
    df = pd.read_csv(
        path,
        skiprows=6,
        dtype=np.float32,
        engine="c",
        encoding="latin-1",  # 头部有 GBK，但跳过后纯 ASCII；latin-1 兼容所有字节
        skipinitialspace=True,
    )
    df.columns = [c.strip() for c in df.columns]
    print(f"  载入 {len(df):,} 行 × {len(df.columns)} 列  ({df.memory_usage().sum()/1e6:.0f} MB)")
    return meta, df


def compute_baselines(df: pd.DataFrame) -> dict[str, np.ndarray]:
    """为每个阻抗通道计算滑动基线（5 分钟中位数）。
    这是临床上"中性"（无吞咽、无反流）状态下的稳态阻抗。
    """
    print("计算滑动阻抗基线（5 分钟中位数）...")
    win = int(BASELINE_WIN_S * SAMPLE_RATE)  # 15000 samples
    baselines = {}
    for ch in IMP_CHANNELS:
        # 用 quantile 0.85 而非 median：因吞咽/反流会把中位数拉低，0.85 分位数更接近真正的"静息"基线
        series = df[ch]
        baseline = series.rolling(win, center=True, min_periods=win // 4).quantile(0.85)
        # 边缘填充
        baseline = baseline.bfill().ffill().to_numpy(dtype=np.float32)
        baselines[ch] = baseline
    return baselines


def detect_impedance_drops(df: pd.DataFrame, baselines: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """对每个阻抗通道，标记"阻抗已下降至基线 50% 以下"的样本（bool 数组）。"""
    drops = {}
    for ch in IMP_CHANNELS:
        imp = df[ch].to_numpy()
        thresh = baselines[ch] * IMP_DROP_RATIO
        drops[ch] = imp < thresh
    return drops


def find_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """在 bool 数组中找出所有 True 连续段的 (start, end_exclusive)。"""
    if not mask.any():
        return []
    diff = np.diff(mask.astype(np.int8), prepend=0, append=0)
    starts = np.where(diff == 1)[0]
    ends = np.where(diff == -1)[0]
    return list(zip(starts.tolist(), ends.tolist()))


def detect_reflux_events(
    df: pd.DataFrame,
    baselines: dict[str, np.ndarray],
    drops: dict[str, np.ndarray],
) -> list[dict]:
    """
    检测反流事件（核心算法）：
      1. 在最远端通道 Imp11 找出所有"阻抗 <50% 基线"的连续段
      2. 对每段，检查是否在 Imp12（次远端）有时序重叠且 Imp12 的下降起点晚于 Imp11
         （逆向传播：远端先，近端后）
      3. 满足以上 → 候选反流事件
      4. 沿近端方向逐通道检查，直到不再传播 → 确定 proximal extent
      5. 用 pH 通道分类
    """
    print("检测反流事件 ...")
    ph = df[PH_CHANNEL].to_numpy()
    distal_runs = find_runs(drops["Imp11"])
    print(f"  Imp11 (最远端) 触发候选: {len(distal_runs):,}")

    events: list[dict] = []
    min_samples = int(MIN_DURATION_S * SAMPLE_RATE)
    lag_samples = int(RETROGRADE_LAG_S * SAMPLE_RATE)

    for d_start, d_end in distal_runs:
        if d_end - d_start < min_samples:
            continue

        # 检查 Imp12 是否在该窗口（±2s）内也有下降，且其起点 ≥ d_start
        win_lo = max(0, d_start - int(2 * SAMPLE_RATE))
        win_hi = min(len(ph), d_end + int(2 * SAMPLE_RATE))

        # 统计每个通道在事件窗口内的"下降起点"（如有）
        channel_drop_starts: dict[str, int | None] = {}
        for ch in IMP_CHANNELS:
            local_mask = drops[ch][win_lo:win_hi]
            if not local_mask.any():
                channel_drop_starts[ch] = None
                continue
            # 找第一个 True 的位置（绝对索引）
            first_true = np.argmax(local_mask) + win_lo
            channel_drop_starts[ch] = int(first_true)

        # 远端 2 个通道必须都有下降，且 Imp12 起点 ≥ Imp11 起点（逆向）
        s11 = channel_drop_starts["Imp11"]
        s12 = channel_drop_starts["Imp12"]
        if s12 is None or s11 is None:
            continue
        if s12 < s11 - lag_samples:
            # Imp12 显著早于 Imp11 → 顺向（吞咽），跳过
            continue

        # 确定 proximal extent: 自 Imp13 起，要求起点不早于前一通道
        proximal_extent = "Imp12"
        prev_start = s12
        for ch in IMP_CHANNELS[2:]:
            ch_start = channel_drop_starts[ch]
            if ch_start is None or ch_start < prev_start - lag_samples:
                break
            proximal_extent = ch
            prev_start = ch_start

        # 事件时长：从 Imp11 下降起点到所有涉及通道阻抗都回到基线 80% 的时刻
        recovery_thresh = {ch: baselines[ch] * 0.8 for ch in IMP_CHANNELS}
        end_idx = d_end
        # 取最晚恢复的通道
        for ch in IMP_CHANNELS:
            if channel_drop_starts[ch] is None:
                continue
            ch_start = channel_drop_starts[ch]
            ch_imp = df[ch].to_numpy()
            # 从 ch_start 向后找第一个 imp > recovery_thresh
            slice_imp = ch_imp[ch_start:]
            slice_thr = recovery_thresh[ch][ch_start:]
            above = slice_imp > slice_thr
            if above.any():
                rec = ch_start + int(np.argmax(above))
                end_idx = max(end_idx, rec)

        start_idx = s11
        if end_idx - start_idx < min_samples:
            continue

        # pH 谷值（事件窗口 + 之后 30s，因为酸到达近端 pH 探头有延迟）
        ph_win = ph[start_idx : min(len(ph), end_idx + int(30 * SAMPLE_RATE))]
        ph_nadir = float(np.nanmin(ph_win))
        ph_start = float(ph[start_idx])

        # 分类
        if ph_nadir < ACID_PH:
            etype = "acid"
        elif ph_nadir > 7.0 and ph_start > 7.0:
            etype = "weakly_alkaline"
        elif ph_nadir < 7.0:
            etype = "weakly_acidic"
        else:
            etype = "non_acid_bolus"

        proximal_cm = CHANNEL_POSITIONS_CM[proximal_extent]
        n_channels = sum(1 for ch in IMP_CHANNELS if channel_drop_starts[ch] is not None)
        duration_s = (end_idx - start_idx) / SAMPLE_RATE

        # 严重度评分 0–100：
        # 时长（0–40分）+ 近端高度（0–30分）+ pH 深度（0–30分）
        score_dur = min(40, duration_s / 60 * 40)           # 1 分钟 = 40 分
        score_prox = (proximal_cm - 3) / 14 * 30             # 3cm→0, 17cm→30
        score_ph = max(0, (7 - ph_nadir) / 7 * 30)
        severity_score = round(score_dur + score_prox + score_ph, 1)
        if severity_score < 25:
            severity = "mild"
        elif severity_score < 55:
            severity = "moderate"
        else:
            severity = "severe"

        notes = []
        if duration_s > 300:
            notes.append("超长反流（>5 分钟），提示食管清除能力受损，常见于食管裂孔疝")
        if proximal_cm >= 15:
            notes.append("反流近端到达 ≥15cm，已达咽喉部，可能引起咳嗽、声嘶等食管外症状")
        if etype == "acid" and ph_nadir < 2:
            notes.append("强酸性反流（pH<2），对食管粘膜损伤显著")

        events.append({
            "id": len(events),
            "start_s": round(start_idx / SAMPLE_RATE, 2),
            "end_s": round(end_idx / SAMPLE_RATE, 2),
            "duration_s": round(duration_s, 2),
            "type": etype,
            "ph_nadir": round(ph_nadir, 2),
            "ph_at_start": round(ph_start, 2),
            "proximal_extent_cm": proximal_cm,
            "proximal_channel": proximal_extent,
            "distal_channels_involved": n_channels,
            "severity": severity,
            "severity_score": severity_score,
            "is_long": duration_s > 300,
            "notes": notes,
        })

    # 合并相邻事件（间隙 <5s）
    merged: list[dict] = []
    for ev in events:
        if merged and ev["start_s"] - merged[-1]["end_s"] < EVENT_GAP_S:
            prev = merged[-1]
            prev["end_s"] = ev["end_s"]
            prev["duration_s"] = round(prev["end_s"] - prev["start_s"], 2)
            prev["ph_nadir"] = min(prev["ph_nadir"], ev["ph_nadir"])
            prev["proximal_extent_cm"] = max(prev["proximal_extent_cm"], ev["proximal_extent_cm"])
            if ev["proximal_extent_cm"] > prev["proximal_extent_cm"]:
                prev["proximal_channel"] = ev["proximal_channel"]
            prev["distal_channels_involved"] = max(prev["distal_channels_involved"], ev["distal_channels_involved"])
            prev["is_long"] = prev["duration_s"] > 300
            # 重新分类（以更严重者为准）
            if prev["ph_nadir"] < ACID_PH:
                prev["type"] = "acid"
            # 重算严重度
            d = prev["duration_s"]
            score_dur = min(40, d / 60 * 40)
            score_prox = (prev["proximal_extent_cm"] - 3) / 14 * 30
            score_ph = max(0, (7 - prev["ph_nadir"]) / 7 * 30)
            prev["severity_score"] = round(score_dur + score_prox + score_ph, 1)
            prev["severity"] = (
                "mild" if prev["severity_score"] < 25
                else "moderate" if prev["severity_score"] < 55 else "severe"
            )
        else:
            merged.append(ev)

    # 重新编号
    for i, ev in enumerate(merged):
        ev["id"] = i
    print(f"  检测到反流事件: {len(merged)} 个（{sum(1 for e in merged if e['type']=='acid')} 酸 / "
          f"{sum(1 for e in merged if e['type']=='weakly_acidic')} 弱酸 / "
          f"{sum(1 for e in merged if e['type']=='non_acid_bolus')} 非酸/弱碱）")
    return merged


def compute_summary(df: pd.DataFrame, events: list[dict], baselines: dict[str, np.ndarray]) -> dict:
    """计算 Lyon Consensus 2.0 关键参数。"""
    print("计算全局指标 ...")
    ph = df[PH_CHANNEL].to_numpy()
    n = len(ph)
    total_s = n / SAMPLE_RATE
    acid_mask = ph < ACID_PH
    aet_pct = float(acid_mask.mean() * 100)

    # 数 pH<4 持续 ≥5s 的酸暴露段
    acid_runs = find_runs(acid_mask)
    min_acid_samples = int(5 * SAMPLE_RATE)
    acid_episodes = [(s, e) for s, e in acid_runs if e - s >= min_acid_samples]
    longest_acid = max((e - s for s, e in acid_episodes), default=0) / SAMPLE_RATE
    long_episodes = sum(1 for s, e in acid_episodes if (e - s) / SAMPLE_RATE > 300)

    # MNBI: 夜间基线阻抗。这里我们没有真实的睡眠时段，用近端通道（Imp17）远离任何反流事件的稳态作为代理
    # 标准做法是取夜间 3 个 10 分钟稳态窗口的中位数
    # 简化版：取整段记录中阻抗最稳定（标准差最小）的 10 分钟窗口的中位数
    mnbi: dict[str, float] = {}
    for ch in IMP_CHANNELS:
        imp = df[ch].to_numpy()
        window = int(10 * 60 * SAMPLE_RATE)  # 10 分钟
        if len(imp) > window:
            # 计算每个 10 分钟窗口的标准差，取最小（最稳定）
            # 用 stride trick 太占内存，改为粗采样：每 5 分钟取一个窗口
            stride = int(5 * 60 * SAMPLE_RATE)
            mnbi_candidates = []
            for start in range(0, len(imp) - window, stride):
                win = imp[start:start + window]
                mnbi_candidates.append((np.std(win), np.median(win)))
            mnbi_candidates.sort()
            mnbi[ch] = float(mnbi_candidates[0][1])
        else:
            mnbi[ch] = float(np.median(imp))

    mnbi_distal = (mnbi["Imp11"] + mnbi["Imp12"]) / 2

    # Lyon 2.0 结论
    if aet_pct > 6:
        diagnosis = "病理性反流（明确 GERD）"
        diagnosis_level = "conclusive"
    elif aet_pct < 4:
        diagnosis = "AET 正常范围"
        diagnosis_level = "normal"
    else:
        diagnosis = "灰区（不确定）—— 需结合症状关联、MNBI 等辅助证据综合判断"
        diagnosis_level = "inconclusive"

    # 辅助证据
    supportive = []
    if len(events) > 80:
        supportive.append(f"24 小时反流事件 {len(events)} 次（>80/天，提示反流频繁）")
    if mnbi_distal < 1500:
        supportive.append(f"远端 MNBI {mnbi_distal:.0f}Ω (<1500Ω，提示粘膜屏障受损)")
    if long_episodes > 0:
        supportive.append(f"{long_episodes} 次超长酸反流（>5 分钟），提示食管清除能力受损（食管裂孔疝特征性表现）")

    return {
        "recording_duration_h": round(total_s / 3600, 2),
        "sample_rate_hz": SAMPLE_RATE,
        "aet_percent": round(aet_pct, 2),
        "aet_threshold_pathological": 6.0,
        "aet_threshold_normal": 4.0,
        "diagnosis": diagnosis,
        "diagnosis_level": diagnosis_level,
        "total_reflux_episodes": len(events),
        "acid_episodes": sum(1 for e in events if e["type"] == "acid"),
        "weakly_acidic_episodes": sum(1 for e in events if e["type"] == "weakly_acidic"),
        "non_acid_episodes": sum(1 for e in events if e["type"] in ("non_acid_bolus", "weakly_alkaline")),
        "longest_acid_episode_s": round(longest_acid, 1),
        "long_episodes_over_5min": long_episodes,
        "mnbi_per_channel": {ch: round(v, 0) for ch, v in mnbi.items()},
        "mnbi_distal_mean": round(mnbi_distal, 0),
        "mnbi_threshold_abnormal": 1500,
        "supportive_evidence": supportive,
        "channel_positions_cm": CHANNEL_POSITIONS_CM,
    }


def build_overview(df: pd.DataFrame, baselines: dict[str, np.ndarray], target_hz: float = 1.0) -> dict:
    """降采样到目标频率，生成总览数据用于全 24h 曲线。"""
    print(f"生成 {target_hz}Hz 总览 ...")
    factor = int(SAMPLE_RATE / target_hz)
    n_out = len(df) // factor

    overview: dict = {
        "sample_rate_hz": target_hz,
        "n_samples": n_out,
        "t": [round(i / target_hz, 1) for i in range(n_out)],
    }

    # pH: 取每个块的中位数（保留谷值信息用 min，但用 median 更稳）
    ph = df[PH_CHANNEL].to_numpy()[: n_out * factor].reshape(n_out, factor)
    overview["pH"] = np.round(np.median(ph, axis=1), 2).tolist()
    overview["pH_min"] = np.round(np.min(ph, axis=1), 2).tolist()

    # 阻抗：归一化到基线百分比（更利于可视化解读）
    for ch in IMP_CHANNELS:
        imp = df[ch].to_numpy()[: n_out * factor].reshape(n_out, factor)
        base = baselines[ch][: n_out * factor].reshape(n_out, factor)
        ratio = imp / np.where(base > 0, base, 1)
        overview[ch] = np.round(np.median(ratio, axis=1) * 100, 1).tolist()  # %

    return overview


def build_zoom(df: pd.DataFrame, baselines: dict[str, np.ndarray], event: dict, hz: float = 10.0) -> dict:
    """为单个事件生成高清放大数据（事件前后 ±30 秒，降到 10Hz）。"""
    factor = int(SAMPLE_RATE / hz)
    pad_s = 30
    start_s = max(0, event["start_s"] - pad_s)
    end_s = event["end_s"] + pad_s
    start_i = int(start_s * SAMPLE_RATE)
    end_i = int(end_s * SAMPLE_RATE)
    n = (end_i - start_i) // factor

    zoom = {
        "event_id": event["id"],
        "start_s": start_s,
        "end_s": start_s + n / hz,
        "sample_rate_hz": hz,
        "t": [round(start_s + i / hz, 2) for i in range(n)],
    }
    ph = df[PH_CHANNEL].to_numpy()[start_i:start_i + n * factor].reshape(n, factor)
    zoom["pH"] = np.round(np.mean(ph, axis=1), 2).tolist()
    for ch in IMP_CHANNELS:
        imp = df[ch].to_numpy()[start_i:start_i + n * factor].reshape(n, factor)
        base = baselines[ch][start_i:start_i + n * factor].reshape(n, factor)
        ratio = imp / np.where(base > 0, base, 1)
        zoom[ch] = np.round(np.mean(ratio, axis=1) * 100, 1).tolist()
    return zoom


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ZOOM_DIR.mkdir(parents=True, exist_ok=True)

    meta, df = parse_csv(RAW_CSV)
    baselines = compute_baselines(df)
    events = detect_reflux_events(df, baselines, detect_impedance_drops(df, baselines))
    summary = compute_summary(df, events, baselines)
    overview = build_overview(df, baselines, target_hz=1.0)

    # 写出
    (OUT_DIR / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    (OUT_DIR / "events.json").write_text(json.dumps(events, ensure_ascii=False, indent=2))
    (OUT_DIR / "overview.json").write_text(json.dumps(overview, ensure_ascii=False))
    print(f"  summary.json: {(OUT_DIR / 'summary.json').stat().st_size / 1024:.1f} KB")
    print(f"  events.json: {(OUT_DIR / 'events.json').stat().st_size / 1024:.1f} KB")
    print(f"  overview.json: {(OUT_DIR / 'overview.json').stat().st_size / 1024:.1f} KB")

    # 每个事件的高清放大
    print(f"生成 {len(events)} 个事件高清窗口 ...")
    for ev in events:
        zoom = build_zoom(df, baselines, ev, hz=10.0)
        (ZOOM_DIR / f"event_{ev['id']:04d}.json").write_text(json.dumps(zoom, ensure_ascii=False))

    print("\n=== 报告摘要 ===")
    print(f"记录时长: {summary['recording_duration_h']} 小时")
    print(f"AET (酸暴露时间): {summary['aet_percent']}%  → {summary['diagnosis']}")
    print(f"反流事件总数: {summary['total_reflux_episodes']}")
    print(f"  - 酸反流: {summary['acid_episodes']}")
    print(f"  - 弱酸反流: {summary['weakly_acidic_episodes']}")
    print(f"  - 非酸/弱碱反流: {summary['non_acid_episodes']}")
    print(f"  - 超长 (>5min) 酸反流: {summary['long_episodes_over_5min']}")
    print(f"远端 MNBI: {summary['mnbi_distal_mean']:.0f} Ω")
    for e in summary["supportive_evidence"]:
        print(f"  ◾ {e}")


if __name__ == "__main__":
    main()
