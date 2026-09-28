const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
let context, page, profile, worker, testExtension;
const pipButton = () => page.locator('twitch-pip-control button');
const active = () => page.evaluate(() => Boolean(document.pictureInPictureElement));

before(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'twitch-pip-test-'));
  testExtension = path.join(profile, 'extension');
  await fs.mkdir(testExtension);
  for (const name of ['app.js', 'background.js', 'icons']) {
    await fs.cp(path.join(root, name), path.join(testExtension, name), { recursive: true });
  }
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  // Invoking the handler through DevTools doesn't grant activeTab like a physical toolbar click.
  // Emulate only that grant in the temporary test copy; the shipped manifest stays minimal.
  manifest.host_permissions = ['https://www.twitch.tv/*'];
  await fs.writeFile(path.join(testExtension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: process.env.HEADLESS === '1',
    viewport: { width: 1100, height: 800 },
    args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`, '--no-first-run']
  });
  context.setDefaultTimeout(10000);
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // Run the real extension on a deterministic Twitch-origin page, without network video dependencies.
  await context.route('https://www.twitch.tv/**', route => route.fulfill({ path: path.join(__dirname, 'player.html'), contentType: 'text/html' }));
  page = await context.newPage();
  await page.goto('https://www.twitch.tv/pip-test');
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await pipButton().waitFor({ state: 'visible' });
});

after(async () => {
  await context?.close();
  if (profile) await fs.rm(profile, { recursive: true, force: true });
});

test('real PiP opens and closes for a live MediaStream', async () => {
  await pipButton().click();
  await page.waitForFunction(() => Boolean(document.pictureInPictureElement));
  assert.equal(await pipButton().getAttribute('aria-pressed'), 'true');
  await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results', 'player.png') });
  await pipButton().click();
  await page.waitForFunction(() => !document.pictureInPictureElement);
});

test('explicit request overrides and restores disablePictureInPicture', async () => {
  await page.evaluate(() => { document.querySelector('video').disablePictureInPicture = true; });
  await pipButton().click();
  await page.waitForFunction(() => Boolean(document.pictureInPictureElement));
  assert.equal(await page.evaluate(() => document.querySelector('video').disablePictureInPicture), false);
  await pipButton().click();
  await page.waitForFunction(() => !document.pictureInPictureElement);
  assert.equal(await page.evaluate(() => document.querySelector('video').disablePictureInPicture), true);
});

test('replacement video after SPA navigation is discovered, hidden previews are ignored', async () => {
  await page.evaluate(() => {
    history.pushState({}, '', '/videos/123456');
    const old = document.querySelector('video');
    const next = document.createElement('video');
    next.id = 'vod';
    next.muted = true;
    next.autoplay = true;
    next.srcObject = window.testStream;
    old.replaceWith(next);
    const preview = document.createElement('video');
    preview.style.display = 'none';
    document.body.prepend(preview);
  });
  await page.waitForFunction(() => document.querySelector('#vod').readyState >= 2);
  await pipButton().click();
  await page.waitForFunction(() => document.pictureInPictureElement?.id === 'vod');
  assert.equal(await page.locator('twitch-pip-control').count(), 1);
  await pipButton().click();
});

test('recorded VOD supports PiP and preserves playback time on return', async () => {
  await page.evaluate(async () => {
    const recorder = new MediaRecorder(window.testStream, { mimeType: 'video/webm' });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const finished = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    await new Promise(resolve => setTimeout(resolve, 1200));
    recorder.stop();
    await finished;
    const video = document.querySelector('#vod');
    video.srcObject = null;
    video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    video.loop = true;
    await video.play();
    video.pause();
    video.currentTime = 0.4;
  });
  await page.waitForFunction(() => !document.querySelector('#vod').seeking);
  await pipButton().click();
  await page.waitForFunction(() => Boolean(document.pictureInPictureElement));
  await pipButton().click();
  await page.waitForFunction(() => !document.pictureInPictureElement);
  assert.ok(Math.abs(await page.locator('#vod').evaluate(v => v.currentTime) - 0.4) < 0.1);
});

test('toolbar handler injects into an existing tab and opens real PiP', async () => {
  const result = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.twitch.tv/*' });
    await handleAction(tab);
    return { badge: await chrome.action.getBadgeText({ tabId: tab.id }), title: await chrome.action.getTitle({ tabId: tab.id }) };
  });
  assert.equal(result.badge, '', result.title);
  assert.equal(await active(), true);
  assert.equal(await page.locator('twitch-pip-control').count(), 1);
  await pipButton().click();
});

test('external PiP close updates button state', async () => {
  await pipButton().click();
  await page.waitForFunction(() => Boolean(document.pictureInPictureElement));
  await page.evaluate(() => document.exitPictureInPicture());
  await page.waitForFunction(() => document.querySelector('twitch-pip-control').shadowRoot.querySelector('button').getAttribute('aria-pressed') === 'false');
});

test('empty media gives a readable error and removing video hides the control', async () => {
  await page.evaluate(() => {
    const video = document.querySelector('#vod');
    video.removeAttribute('src');
    video.load();
  });
  await pipButton().click();
  assert.match(await page.locator('twitch-pip-control .status').textContent(), /Дождитесь загрузки/);
  assert.equal(await active(), false);
  await page.evaluate(() => document.querySelector('#vod').remove());
  await pipButton().waitFor({ state: 'hidden' });
});

test('toolbar rejects other websites without injecting code', async () => {
  const result = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.twitch.tv/*' });
    await handleAction({ id: tab.id, url: 'https://example.com/' });
    return { badge: await chrome.action.getBadgeText({ tabId: tab.id }), title: await chrome.action.getTitle({ tabId: tab.id }) };
  });
  assert.equal(result.badge, '!');
  assert.match(result.title, /Откройте стрим/);
});
