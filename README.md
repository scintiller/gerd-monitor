# 24 小时食管阻抗-pH 监测分析（病例 001）

把一份 24 小时多通道腔内阻抗-pH 监测（MII-pH）数据从原始 CSV 处理成可交互的网页，自动检测反流事件、按 Lyon Consensus 2.0 标准给出诊断，并以**医生视角**和**病人视角**两种模式呈现。

**🌐 在线 Demo：[gerd-001.pages.dev](https://gerd-001.pages.dev)**（国内、海外均可访问）

## 截图

### 病人视角 · 总览

> 诊断结论 + 关键指标 + 反流次数分布 + 三种类型对比 + 你可能会问 FAQ + 24h 时间序列

![病人视角总览](docs/screenshots/01-patient-overview.png)

### 病人视角 · 单次反流事件细节（事件 #2，重度 76.9）

> 自动放大到该事件 ±12s 窗口，标注反流起止、pH 最低点、近端到达高度；右侧严重度分解条直观展示「为什么是重度」（时长 40/40 + 高度 30/30 + pH 6.9/30）

![病人视角事件细节](docs/screenshots/02-patient-event-detail.png)

### 医生视角 · 全局诊断（Lyon Consensus 2.0）

> AET 0.17%、各通道 MNBI、反流次数分布、诊断结论与辅助证据

![医生视角总览](docs/screenshots/03-doctor-overview.png)

### 医生视角 · 单次反流事件（Porto Consensus 检测依据）

> 同一事件展示 Porto Consensus 的所有判定条件（50% 阻抗下降、逆向传播、远端 ≥2 通道、≥5s）+ 严重度评分细节

![医生视角事件细节](docs/screenshots/04-doctor-event-detail.png)

### 📹 演示视频

完整交互演示见 [Release v0.1 附件](https://github.com/scintiller/gerd-monitor/releases/tag/v0.1)（mov, ~120MB）。

## 数据

- `001.rar` / `001.csv` — 病例 001 的 24 小时 MII-pH 原始数据
  - 13 通道：1 个 pH（5 cm above LES）+ 6 个阻抗段（3·5·7·9·15·17 cm above LES）+ 6 个参考电极
  - 采样率：50 Hz（统一后），原始 pH/Base 1 Hz，Imp 50 Hz
  - 记录时长：23.76 小时（4,277,251 样本）
  - 文件大小：524.8 MB

## 项目结构

```
.
├── 001.rar / 001.csv           # 原始数据
├── scripts/preprocess.py       # 反流事件检测算法 + 数据精简
├── data/processed/             # 预处理输出
│   ├── summary.json            # 全局指标（AET、MNBI、诊断结论等）
│   ├── events.json             # 所有反流事件 + 标注
│   ├── overview.json           # 1Hz 总览（约 86k 点/通道）
│   └── zoom/event_NNNN.json    # 每个事件 ±30s 10Hz 高清窗口
├── web/                        # 前端（Vite + React + TS + Tailwind + uPlot）
└── .venv/                      # Python 3.12 虚拟环境
```

## 反流检测算法（基于国际共识）

### 阈值标准（Lyon Consensus 2.0, Porto Consensus）

- **酸反流**：pH 从 >4 降至 <4，持续 ≥5 秒
- **bolus 反流**（含酸/弱酸/非酸）：
  - 最远端阻抗通道下降至基线 50% 以下
  - 逆向传播：远端先于近端（吞咽则相反）
  - 至少累及远端 2 个阻抗段
  - 持续 ≥5 秒
- **分类**：根据 pH 谷值
  - `acid` (酸反流): pH 谷值 <4
  - `weakly_acidic` (弱酸反流): pH 4–7
  - `non_acid_bolus` / `weakly_alkaline`: pH ≥7
- **严重度评分**（0–100 分，自定义综合公式）
  - 时长（0–40 分，1 分钟封顶）
  - 近端高度（0–30 分，3cm→0，17cm→30）
  - pH 深度（0–30 分，pH 7→0，pH 0→30）
  - 分级：<25 轻度 · 25–55 中度 · ≥55 重度

### Lyon Consensus 2.0 诊断阈值

| 指标 | 正常 | 灰区 | 病理 |
|-----|------|------|------|
| AET（酸暴露时间） | <4% | 4–6% | >6% |
| 反流总次数 | — | — | >80/天（辅助证据） |
| MNBI（远端） | — | — | <1500 Ω（辅助证据） |

## 跑起来

### 1. 数据预处理（Python）

```bash
# 装 uv（如未安装）
brew install uv

# 建 venv + 装依赖
uv venv --python 3.12 .venv
uv pip install pandas numpy scipy pyarrow

# 跑预处理
.venv/bin/python scripts/preprocess.py
```

预处理输出会写到 `data/processed/`，然后复制（或软链接）到 `web/public/data/`。

### 2. 网站本地预览

```bash
cd web
npm install
npm run dev
```

默认端口 `http://localhost:5173`。

### 3. 构建静态站点（待部署）

```bash
cd web
npm run build
```

输出在 `web/dist/`，可以部署到 Vercel / Netlify / GitHub Pages / 任意静态托管。

## 界面功能

### 顶部切换
- **病人视角**：用日常语言解释结果，4 个大数字卡片+背景知识，每个事件附「为什么这是反流 / 有多严重 / 怎么办」
- **医生视角**：Lyon Consensus 2.0 标准报告参数、各通道 MNBI、Porto Consensus 检测依据、严重度评分公式

### 24 小时总览图
- 顶部彩色色带 = 反流事件（条高度=严重度，颜色=类型）
- 中间黑色细线 = pH，红色虚线是 pH=4 酸阈
- 阻抗细节默认隐藏，可按需开启 6 个通道叠加显示
- 鼠标悬停在色带上显示事件 tooltip
- 点击色带或事件列表跳转到详情

### 事件详情
- 高清放大图（±30s 窗口，10Hz）
- 红色虚线标记事件起止，粉色背景标识反流时段
- 4 个关键指标卡（时长 / pH 谷值 / 近端高度 / 累及通道数）
- 病人视角：3 个故事性说明块
- 医生视角：Porto Consensus 检测依据 + 严重度评分细节 + 临床提示

## 病例 001 摘要

- **诊断结论（Lyon Consensus 2.0）**：AET 正常范围（0.17%）
- **反流总数**：32 次（1 酸 / 31 弱酸 / 0 非酸）
- **最长酸反流**：9 秒
- **远端 MNBI**：4020 Ω（>1500 Ω 阈值，粘膜屏障完整）

虽然 AET 在正常范围，但 31 次弱酸反流值得关注，尤其结合食管裂孔疝病史。
弱酸反流在抑酸治疗（PPI）期间常见，也是部分 PPI 抵抗症状的常见原因。

## 算法依据

- Gyawali CP et al. **Updates to the modern diagnosis of GERD: Lyon Consensus 2.0**. Gut 2024.
- Sifrim D et al. **Acid, nonacid, and gas reflux in patients with gastroesophageal reflux disease during ambulatory 24-hour pH-impedance recordings**. Gastroenterology 2001.
- Roman S et al. **Ambulatory reflux monitoring for diagnosis of gastro-esophageal reflux disease: Update of the Porto consensus**. Neurogastroenterol Motil 2017.

## 声明

本工具仅用于研究和教育目的，**不能替代专业医疗诊断**。所有数据已匿名化处理（病例 001）。
