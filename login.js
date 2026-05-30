const { chromium } = require('playwright');
const path = require('path');

const AUTH_FILE = path.join(__dirname, 'auth.json');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  await page.goto('https://open.bigmodel.cn/glm-coding', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  console.log('请在浏览器中完成登录（手机号/微信扫码等任意方式）。');
  console.log('登录成功后，回到终端按 Enter 键保存登录状态...');

  // Wait for user to press Enter
  process.stdin.setEncoding('utf8');
  await new Promise((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  // Verify we're logged in
  const loginBtn = page.locator('button:has-text("登录")');
  if (await loginBtn.isVisible().catch(() => false)) {
    console.log('似乎还未登录，请确认登录状态。');
    // Wait once more
    console.log('登录成功后按 Enter 继续...');
    await new Promise((resolve) => {
      process.stdin.once('data', () => resolve());
    });
  }

  await context.storageState({ path: AUTH_FILE });
  console.log(`登录状态已保存到: ${AUTH_FILE}`);

  await browser.close();
})();
