const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const AUTH_FILE = path.join(__dirname, 'auth.json');
const TARGET_URL = 'https://open.bigmodel.cn/glm-coding';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function ts() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function getTargetTime() {
  const now = new Date();
  const t = new Date(now);
  t.setHours(10, 0, 0, 0);
  return t;
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const contextOptions = {
    viewport: { width: 1920, height: 1080 },
  };
  if (fs.existsSync(AUTH_FILE)) {
    contextOptions.storageState = AUTH_FILE;
    console.log('[%s] 已加载登录状态', ts());
  } else {
    console.warn('[%s] auth.json 不存在，请先运行: node login.js', ts());
  }

  const context = await browser.newContext(contextOptions);

  // Block analytics/tracking for speed
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (['googletagmanager.com', 'google-analytics.com', 'hm.baidu.com', 'qiyukf.com',
      'sensorsdata.cn', 'sentry.io'].some((d) => url.includes(d))) {
      return route.abort();
    }
    return route.continue();
  });

  const page = await context.newPage();

  // ── Monitor batch-preview API ──
  let batchPreviewOk = false;
  page.on('response', async (res) => {
    if (res.url().includes('batch-preview')) {
      try {
        const body = await res.json();
        if (body.code !== 555) {
          batchPreviewOk = true;
          console.log('[%s] 📡 batch-preview 返回成功! code=%s', ts(), body.code);
        }
      } catch {}
    }
  });

  // ── Phase 1: 初始加载 ──
  console.log('[%s] 正在加载页面...', ts());
  await page.goto(TARGET_URL, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForSelector('.package-card-box .buy-btn', { timeout: 30000 });
  await page.waitForTimeout(500);

  // Login check
  const loginBtn = page.locator('button:has-text("登录")');
  if (await loginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.error('[%s] 未登录！请先运行 node login.js', ts());
    await browser.close();
    process.exit(1);
  }
  console.log('[%s] 登录有效，页面就绪', ts());

  // ── Phase 2: 等待 10:00 准时刷新抢购 ──
  const target = getTargetTime();
  let clicked = false;

  while (!clicked) {
    const now = Date.now();
    if (now < target) {
      const waitMs = target - now - 100;
      if (waitMs > 10000) {
        console.log('[%s] ⏳ 距 10:00 还有 %.0f 秒', ts(), waitMs / 1000);
      }
      if (waitMs > 0) {
        await sleep(Math.min(waitMs, 5000));
        continue;
      }
      // Final spin
      while (Date.now() < target) {}
    }

    // 10:00 — reload page to get fresh stock state
    const t0 = Date.now();
    batchPreviewOk = false;
    await page.reload({ waitUntil: 'commit', timeout: 10000 });
    try {
      await page.waitForSelector('.package-card-box .buy-btn', { timeout: 8000 });
    } catch {
      console.log('[%s] 渲染超时，重试...', ts());
      continue;
    }

    const reloadMs = Date.now() - t0;

    // Check Max button
    const maxBtn = page.locator(
      '.package-card-box:has(.package-card-title:has-text("Max")) .buy-btn'
    );
    const btnText = (await maxBtn.textContent().catch(() => '')).trim();
    const isDisabled = await maxBtn.evaluate((el) => el.disabled).catch(() => true);

    console.log('[%s] 刷新%ims → Max: "%s" %s',
      ts(), reloadMs, btnText, isDisabled ? '❌' : '🔥');

    if (!isDisabled && btnText.includes('订阅')) {
      console.log('[%s] 🔥 点击 Max 特惠订阅！', ts());
      await maxBtn.click();
      clicked = true;
      break;
    }

    // Fallback: if batch-preview returned OK but button still disabled,
    // force-enable via Vue state
    if (batchPreviewOk && isDisabled) {
      console.log('[%s] API 返回成功但按钮仍禁用，尝试通过 Vue 强制启用...', ts());
      const forced = await page.evaluate(() => {
        const root = document.querySelector('#app').__vue__;
        function findVm(vm, d) {
          if (d > 5 || !vm) return null;
          if (vm.$data && vm.$data.hasOwnProperty('isServerBusy')) return vm;
          if (vm.$children) for (const c of vm.$children) { const r = findVm(c, d + 1); if (r) return r; }
          return null;
        }
        const vm = findVm(root, 0);
        if (vm) {
          vm.$data.isServerBusy = false;
          vm.$data.cardDataArr?.forEach((c) => { c.disabled = false; });
          vm.$forceUpdate();
          return true;
        }
        return false;
      });
      if (forced) {
        await page.waitForTimeout(200);
        const stillDisabled = await maxBtn.evaluate((el) => el.disabled).catch(() => true);
        if (!stillDisabled) {
          console.log('[%s] 🔥 Vue 强制启用成功，点击！', ts());
          await maxBtn.click();
          clicked = true;
          break;
        }
      }
    }

    // After 10:10, give up
    if (Date.now() > target + 600_000) {
      console.log('[%s] 已超 10 分钟，停止。', ts());
      break;
    }
  }

  if (!clicked) {
    console.log('[%s] 未抢到，按 Enter 关闭...', ts());
    await new Promise((r) => process.stdin.once('data', r));
    await browser.close();
    process.exit(0);
  }

  // ── Phase 3: 确认弹窗 ──
  console.log('[%s] 等待确认弹窗...', ts());
  const continueBtn = page.locator('button.continue-btn:has-text("继续订阅")');
  try {
    await continueBtn.waitFor({ state: 'visible', timeout: 5000 });
    console.log('[%s] 点击"已知悉，继续订阅"', ts());
    await continueBtn.click();
  } catch {
    console.log('[%s] 无需确认弹窗', ts());
  }

  // ── Phase 4: 实名认证 ──
  if (await page.locator('button:has-text("前往认证")').isVisible({ timeout: 2000 }).catch(() => false)) {
    console.error('[%s] 需要实名认证！', ts());
    console.log('按 Enter 关闭...');
    await new Promise((r) => process.stdin.once('data', r));
    await browser.close();
    process.exit(1);
  }

  // ── Phase 5: 验证码 / 支付 ──
  console.log('──────────────────────────────');
  console.log('验证码/支付请手动完成 (最多 120s)');
  console.log('──────────────────────────────');

  const maxWait = Date.now() + 120_000;
  while (Date.now() < maxWait) {
    const captcha = page.frameLocator('iframe[src*="captcha"]').first();
    if (await captcha.locator('body').isVisible().catch(() => false)) {
      console.log('[%s] 🔐 验证码，请手动完成', ts());
    }
    const payDone = page.locator('.pay-success-dialog-box');
    if (await payDone.isVisible().catch(() => false)) {
      const t = await payDone.textContent().catch(() => '');
      console.log('[%s] 结果: %s', ts(), t.trim().slice(0, 150));
    }
    await sleep(1000);
  }

  console.log('[%s] 60秒后关闭...', ts());
  await sleep(60000);
  await browser.close();
  console.log('完成。');
})();
