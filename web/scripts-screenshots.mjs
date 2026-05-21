// 批量截图脚本：拍多种状态的 README 截图
// 用法: node scripts/screenshots.mjs
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');
const URL = 'https://gerd-001.pages.dev';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const WIDTH = 1600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, text, exact = true) {
  const handle = await page.evaluateHandle((t, exact) => {
    const buttons = [...document.querySelectorAll('button')];
    return buttons.find((b) => exact ? b.textContent.trim() === t : b.textContent.includes(t));
  }, text, exact);
  if (await handle.evaluate((el) => !!el)) {
    await handle.evaluate((el) => el.click());
    return true;
  }
  return false;
}

async function setSelectedById(page, id) {
  await page.evaluate((id) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.match(new RegExp(`^#${id} `)));
    if (btn) btn.click();
  }, id);
}

async function screenshot(page, file) {
  await sleep(800); // 等动画/重绘
  const full = path.join(OUT_DIR, file);
  await page.screenshot({ path: full, fullPage: true });
  const stats = await import('node:fs').then(m => m.statSync(full));
  console.log(`✓ ${file} (${(stats.size/1024).toFixed(0)} KB)`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: WIDTH, height: 1200, deviceScaleFactor: 2 }, // 2x for HiDPI
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  // 1) 病人视角 - 24h 总览
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await sleep(2000); // 等 overview.json (12MB) 加载完
  await screenshot(page, '01-patient-overview.png');

  // 2) 病人视角 - 点击事件 #2（弱酸反流 17cm 重度）→ 自动缩放 + 详情
  await setSelectedById(page, 2);
  await sleep(1200);
  await screenshot(page, '02-patient-event-detail.png');

  // 3) 医生视角 - 全局指标 + MNBI 详情
  await clickByText(page, '医生视角');
  await sleep(800);
  // 取消事件选择以看到完整的诊断面板
  await page.evaluate(() => {
    const reset = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('重置 24h'));
    if (reset) reset.click();
  });
  await sleep(800);
  await screenshot(page, '03-doctor-overview.png');

  // 4) 医生视角 - 事件 #2 详情（Porto Consensus 检测依据 + 严重度分解）
  await setSelectedById(page, 2);
  await sleep(1200);
  await screenshot(page, '04-doctor-event-detail.png');

  console.log('\nAll screenshots saved to docs/screenshots/');
} finally {
  await browser.close();
}
