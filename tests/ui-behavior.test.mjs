import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Element, installDOM, find, walk, button, settle } from './dom-fixture.mjs';
import { endpoints } from '../webui/static/js/api.js';
import { render as renderWizard } from '../webui/static/js/pages/setup.js';
import { render as renderSettings } from '../webui/static/js/pages/settings.js';
import { render as renderOverview } from '../webui/static/js/pages/overview.js';
import { render as renderModels } from '../webui/static/js/pages/models.js';
import { renderAdapter, renderSummary, buildPayload } from '../webui/static/js/setup/steps.js';

const sequence = ['welcome', 'main_model_quick', 'features', 'embedding', 'adapter', 'persona', 'summary'];
const context = () => ({ toast() {}, navigate() {}, onDone() {}, onEvent: () => () => {} });
const checkbox = (node) => find(node, (child) => child.tagName === 'input' && child.type === 'checkbox');
const input = (node) => find(node, (child) => child.tagName === 'input');
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => {
  installDOM();
  for (const name of Object.keys(endpoints)) {
    endpoints[name] = async () => { throw new Error(`Unexpected endpoint: ${name}`); };
  }
});

function setupEndpoints() {
  endpoints.setupOptions = async () => ({
    presets: [{ id: 'deepseek', display_name: 'DeepSeek', models: [{ id: 'deepseek-chat' }] }],
    steps: sequence.map((id) => ({ id, title: id })),
    defaults: { preset: 'deepseek', model: 'deepseek-chat' },
    personas: [],
  });
  endpoints.setupCopy = async () => ({});
  endpoints.setupStep = async ({ current }) => {
    const index = sequence.indexOf(current);
    return { next: sequence[index + 1], prev: sequence[index - 1],
      is_last: current === 'summary', progress: [index + 1, sequence.length] };
  };
}

async function startWizard(ctx = context()) {
  const host = new Element('div');
  const view = renderWizard(host, ctx);
  await settle();
  return { host, view };
}

async function reachSummary(host) {
  await button(host, '下一步').fire('click');
  const key = find(host, (node) => node.type === 'password');
  key.value = 'test-only-key';
  await key.fire('input');
  for (let i = 0; i < sequence.length - 2; i++) await button(host, '下一步').fire('click');
  assert(button(host, '完成配置'));
}

test('wizard validation failure allows correction and retry', async () => {
  setupEndpoints();
  const { host } = await startWizard();
  await button(host, '下一步').fire('click');
  await button(host, '下一步').fire('click');
  assert(host.textContent.includes('还没填 API Key'));
  assert.equal(button(host, '下一步').disabled, false);
  const key = find(host, (node) => node.type === 'password');
  key.value = 'corrected';
  await key.fire('input');
  await button(host, '下一步').fire('click');
  assert.equal(find(host, (node) => node.tagName === 'h2').textContent, 'features');
});

test('wizard flow error can be retried without leaving the step', async () => {
  setupEndpoints();
  const { host } = await startWizard();
  const normal = endpoints.setupStep;
  endpoints.setupStep = async () => { throw new Error('flow unavailable'); };
  await button(host, '下一步').fire('click');
  assert(host.textContent.includes('flow unavailable'));
  assert.equal(button(host, '下一步').disabled, false);
  endpoints.setupStep = normal;
  await button(host, '下一步').fire('click');
  assert.equal(find(host, (node) => node.tagName === 'h2').textContent, 'main_model_quick');
});

test('wizard options can be retried and navigation stays disabled before loading', async () => {
  setupEndpoints();
  const normal = endpoints.setupOptions;
  endpoints.setupOptions = async () => { throw new Error('options unavailable'); };
  const { host } = await startWizard();
  assert.equal(button(host, '下一步').disabled, true);
  endpoints.setupOptions = normal;
  await button(host, '重新读取向导选项').fire('click');
  assert.equal(button(host, '下一步').disabled, false);
});

test('wizard blocks duplicate navigation while a request is pending', async () => {
  setupEndpoints();
  const { host } = await startWizard();
  const normal = endpoints.setupStep;
  const gate = deferred();
  let calls = 0;
  endpoints.setupStep = async (payload) => {
    if (payload.current === 'welcome') { calls++; await gate.promise; }
    return normal(payload);
  };
  const next = button(host, '下一步');
  const pending = next.fire('click');
  assert.equal(next.disabled, true);
  assert.equal(button(host, '上一步').disabled, true);
  await next.fire('click');
  assert.equal(calls, 1);
  gate.resolve();
  await pending;
  assert.equal(next.disabled, false);
});

test('wizard apply failure permits retry; QQ stays disabled by default', async () => {
  setupEndpoints();
  let done = 0;
  const { host } = await startWizard({ ...context(), onDone: () => { done++; } });
  await reachSummary(host);
  endpoints.setupApply = async () => { throw new Error('write failed'); };
  await button(host, '完成配置').fire('click');
  assert(host.textContent.includes('write failed'));
  assert.equal(button(host, '完成配置').disabled, false);
  endpoints.setupApply = async (payload) => {
    assert.equal(payload.adapter.enabled, false);
    assert.equal(payload.providers[0].api_key, 'test-only-key');
    return { started: true };
  };
  await button(host, '完成配置').fire('click');
  assert.equal(done, 1);
});

test('summary links return to a populated step', async () => {
  setupEndpoints();
  const { host } = await startWizard();
  await reachSummary(host);
  await find(host, (node) => node['aria-label'] === '修改主模型').fire('click');
  assert.equal(find(host, (node) => node.type === 'password').value, 'test-only-key');
  assert.equal(find(host, (node) => node.tagName === 'h2').textContent, 'main_model_quick');
});

function wizardState() {
  return { path: 'recommended', provider: { id: 'main', model: 'model', api_key: 'test' },
    chat: {}, agents: {}, features: {}, behavior: {}, persona: 'test',
    adapter: { enabled: true, mode: 'client', host: '127.0.0.1', port: 3000, path: '/',
      whitelist: { mode: 'whitelist', qq_ids: [], group_ids: [] } } };
}

test('whitelist preserves text across rerenders and normalizes IDs without precision loss', async () => {
  const host = new Element('div');
  const state = wizardState();
  renderAdapter(host, {}, state);
  const textarea = find(host, (node) => node.tagName === 'textarea');
  textarea.value = '12345678901234567890，12345678901234567890、456\n';
  await textarea.fire('input');
  const view = renderAdapter(host, {}, state);
  assert.equal(find(host, (node) => node.tagName === 'textarea').value, textarea.value);
  assert.equal(view.validate(), null);
  assert.deepEqual(buildPayload(state).adapter.whitelist.qq_ids, ['12345678901234567890', '456']);
});

test('channel validation checks enabled connection and skips disabled fields', () => {
  const state = wizardState();
  const host = new Element('div');
  const validate = () => renderAdapter(host, {}, state).validate();
  assert.match(validate(), /至少/);
  state.adapter.whitelist.qq_ids = '123';
  assert.equal(validate(), null);
  for (const port of [0, 65536, 1.5, NaN]) {
    state.adapter.port = port;
    assert.match(validate(), /端口/);
  }
  state.adapter.port = 3000;
  for (const value of ['', 'ws://localhost', 'has space']) {
    state.adapter.host = value;
    assert.match(validate(), /地址/);
  }
  state.adapter.host = 'localhost';
  state.adapter.path = 'missing-slash';
  assert.match(validate(), /路径/);
  state.adapter.path = '/';
  state.adapter.whitelist.qq_ids = 'abc';
  assert.match(validate(), /数字/);
  state.adapter.enabled = false;
  state.adapter.port = 0;
  assert.equal(validate(), null);
  assert.equal(buildPayload(state).adapter.enabled, false);
});

test('summary reflects implicit enabled agents and explicit disabled agents', () => {
  const host = new Element('div');
  const state = wizardState();
  state.adapter.enabled = false;
  renderSummary(host, {}, state);
  assert(host.textContent.includes('主动思考启用 · 跟随主模型'));
  assert(host.textContent.includes('可能额外调用模型并产生费用'));
  assert(host.textContent.includes('暂不连接 QQ'));
  state.agents = { proactive: { enabled: false }, summary: false };
  renderSummary(host, {}, state);
  assert(host.textContent.includes('主动思考关闭'));
  assert(host.textContent.includes('滚动摘要关闭'));
  assert.deepEqual(buildPayload(state).agents.proactive, { enabled: false });
});

async function settingsFor(spec) {
  endpoints.settings = async () => ({ groups: [{ key: 'basic', title: '基本', fields: [spec] }] });
  endpoints.adapterProtocols = async () => { throw { status: 404 }; };
  const host = new Element('div');
  await renderSettings(host, context());
  return host;
}

for (const spec of [
  { type: 'bool', value: false, edited: true, event: 'change' },
  { type: 'enum', value: 'old', edited: 'new', event: 'change', options: [['old', '旧'], ['new', '新']] },
  { type: 'str', value: 'saved', edited: 'unsaved', event: 'blur' },
]) {
  test(`rejected ${spec.type} setting restores the confirmed value and permits retry`, async () => {
    const host = await settingsFor({ ...spec, path: 'app.test', label: '测试' });
    endpoints.patchSetting = async () => { throw new Error('rejected'); };
    let control = find(host, (node) => ['input', 'select'].includes(node.tagName));
    const property = spec.type === 'bool' ? 'checked' : 'value';
    control[property] = spec.edited;
    await control.fire(spec.event);
    control = find(host, (node) => ['input', 'select'].includes(node.tagName));
    assert.equal(control[property], spec.value);
    assert.equal(control.disabled, false);
    assert(host.textContent.includes('保存失败，已恢复'));
    endpoints.patchSetting = async () => ({ value: spec.edited, needs_restart: false });
    control[property] = spec.edited;
    await control.fire(spec.event);
    control = find(host, (node) => ['input', 'select'].includes(node.tagName));
    assert.equal(control[property], spec.edited);
    assert(host.textContent.includes('已保存并生效'));
  });
}

test('settings use server-normalized values and serialize duplicate saves', async () => {
  const host = await settingsFor({ path: 'app.test', label: '文本', type: 'str', value: 'old' });
  const gate = deferred();
  let calls = 0;
  endpoints.patchSetting = async () => { calls++; await gate.promise; return { value: 'normalized' }; };
  const control = input(host);
  control.value = ' raw ';
  const pending = control.fire('keydown', { key: 'Enter' });
  assert.equal(control.disabled, true);
  await control.fire('blur');
  assert.equal(calls, 1);
  gate.resolve();
  await pending;
  await settle();
  assert.equal(input(host).value, 'normalized');
});

test('settings restart failure restores the button after native event dispatch', async () => {
  const host = await settingsFor({ path: 'app.test', label: '开关', type: 'bool', value: false });
  endpoints.patchSetting = async () => ({ value: true, needs_restart: true });
  checkbox(host).checked = true;
  await checkbox(host).fire('change');
  endpoints.restart = async () => { throw new Error('restart failed'); };
  const restart = button(host, '立即重启 Runtime');
  await restart.fire('click');
  assert.equal(restart.disabled, false);
});

test('cancelling WebUI restart restores the button and preserves its pending hint', async () => {
  const host = await settingsFor({ path: 'webui.allow_lan', label: '局域网', type: 'bool', value: false });
  endpoints.patchSetting = async () => ({ value: true, needs_restart: true, restart_scope: 'webui' });
  checkbox(host).checked = true;
  await checkbox(host).fire('change');
  const restart = button(host, '立即重启 WebUI');
  const pending = restart.fire('click');
  assert.equal(restart.disabled, true);
  await button(document.body, '稍后').fire('click');
  await pending;
  assert.equal(restart.disabled, false);
  assert(host.textContent.includes('监听地址已保存'));
});

test('overview restart restores the button on both success and failure', async () => {
  const host = new Element('div');
  const view = await renderOverview(host, context());
  try {
    for (const fail of [false, true]) {
      endpoints.restart = async () => { if (fail) throw new Error('restart failed'); return {}; };
      const restart = button(host, '重启 Runtime');
      await restart.fire('click');
      assert.equal(restart.disabled, false);
    }
  } finally { view.destroy(); }
});

test('model dependency installer restores its button after an error', async () => {
  endpoints.models = async () => ({ models: [{ name: 'test', display_name: 'Test model', missing_deps: ['example'] }] });
  const host = new Element('div');
  const view = await renderModels(host, context());
  try {
    const row = find(host, (node) => node.tagName === 'tr' && node.textContent.includes('Test model'));
    await row.fire('click');
    endpoints.installModelDeps = async () => { throw new Error('install failed'); };
    const install = button(host, '安装依赖（example）');
    await install.fire('click');
    assert.equal(install.disabled, false);
  } finally { view.destroy(); }
});

const backupComponents = [
  { id: 'config', label: '配置', bytes: 1200, formatted: '1.2 KiB', available: true },
  { id: 'credentials', label: '凭据', bytes: 800, formatted: '800 B', available: true },
  { id: 'chats', label: '聊天记录', bytes: 4096, formatted: '4.0 KiB', available: true },
  { id: 'rag', label: 'RAG 数据', bytes: 0, formatted: '0 B', available: true },
  { id: 'workspace', label: '工作区', bytes: 2048, formatted: '2.0 KiB', available: true },
  { id: 'emoji', label: '表情包', bytes: 1024, formatted: '1.0 KiB', available: true },
  { id: 'providers', label: '自定义预设', bytes: 512, formatted: '512 B', available: true },
  { id: 'personas', label: '人格', bytes: 256, formatted: '256 B', available: true },
];

async function backupSettings() {
  endpoints.settings = async () => ({ groups: [{ key: 'backup', title: '备份与恢复', desc: '', fields: [] }] });
  endpoints.adapterProtocols = async () => { throw { status: 404 }; };
  endpoints.backupStatus = async () => ({ directory: '/tmp/backups', include_media: false, jobs: [], files: [] });
  endpoints.backupComponents = async () => ({ components: backupComponents, total_bytes: 9936 });
  endpoints.backupDownloadUrl = (filename) => `/download/${filename}`;
  const host = new Element('div');
  await renderSettings(host, context());
  return host;
}

async function openRestoreSelection(host, filenames) {
  endpoints.backupStatus = async () => ({ directory: '/tmp/backups', files: filenames.map((filename) => (
    { filename, size: 20, created_at: 1 }
  )), jobs: [] });
  await button(host, '刷新').fire('click');
  endpoints.backupVerify = async (filename) => ({ ok: true, filename, components: [
    { id: 'config', label: '配置', archive_bytes: 100, target_bytes: 50,
      files: 1, overwrite_files: 1, delete_files: 0, available: true, restorable: true },
    { id: 'chats', label: '聊天记录', archive_bytes: 1000, target_bytes: 500,
      files: 2, overwrite_files: 1, delete_files: 0, available: true, restorable: true },
  ] });
  const chooser = (name) => walk(host).find((node) => {
    if (node.tagName !== 'button' || node.textContent !== '选择恢复') return false;
    let parent = node.parentNode;
    while (parent && !parent.classList?.contains('backup-file')) parent = parent.parentNode;
    return Boolean(parent?.textContent.includes(name));
  });
  await chooser(filenames[0]).fire('click');
  return chooser;
}

test('backup panel lets users select component content and reports per-component size', async () => {
  const host = await backupSettings();
  assert(host.textContent.includes('聊天记录'));
  assert(host.textContent.includes('1.2 KiB'));
  assert(host.textContent.includes('已选 8 项'));
  const workspace = find(host, (node) => node.tagName === 'label'
    && node.textContent.includes('工作区'));
  const workspaceCheckbox = find(workspace, (node) => node.tagName === 'input');
  workspaceCheckbox.checked = false;
  await workspaceCheckbox.fire('change');
  assert(host.textContent.includes('已选 7 项'));
  let submitted;
  endpoints.backupStart = async (payload) => {
    submitted = payload;
    return { id: 'job-1', state: 'running', stage: 'writing', operation: 'backup', filename: 'backup.zip', size: 42,
      component_progress: { config: { estimated_bytes: 1200, processed_bytes: 400, actual_bytes: 800 } } };
  };
  const jobGate = deferred();
  endpoints.backupJob = async () => jobGate.promise;
  endpoints.backupRestoreJob = async () => ({ id: 'restore-1', state: 'done', operation: 'restore' });
  await button(host, '立即备份').fire('click');
  assert.deepEqual(submitted.components, backupComponents.filter((item) => item.id !== 'workspace').map((item) => item.id));
  assert(host.textContent.includes('400 B'));
  assert.equal(button(host, '立即备份').disabled, true);
  jobGate.resolve({ id: 'job-1', state: 'done', operation: 'backup' });
  await settle();
  await settle();
  assert.equal(button(host, '立即备份').disabled, false);
});

test('workspace media is a subordinate backup choice and is sent only with workspace', async () => {
  endpoints.backupComponents = async () => ({
    components: backupComponents.map((item) => item.id === 'workspace'
      ? { ...item, bytes: 3072, bytes_with_media: 3072, bytes_without_media: 2048 }
      : item),
    total_bytes: 10960, include_media: true,
  });
  const host = await backupSettings();
  const media = find(host, (node) => node.type === 'checkbox'
    && node.parentNode?.textContent.includes('入站媒体'));
  assert(media);
  assert.equal(media.disabled, false);
  media.checked = false;
  await media.fire('change');
  assert(host.textContent.includes('已选 8 项 · 约 9.7 KiB'));
  const workspace = find(host, (node) => node.tagName === 'label'
    && node.textContent.includes('工作区'));
  const workspaceCheckbox = find(workspace, (node) => node.tagName === 'input');
  workspaceCheckbox.checked = false;
  await workspaceCheckbox.fire('change');
  assert.equal(media.disabled, true);
  workspaceCheckbox.checked = true;
  await workspaceCheckbox.fire('change');
  assert.equal(media.disabled, false);
  let payload;
  endpoints.backupStart = async (value) => { payload = value; return { id: 'job-media', state: 'done' }; };
  endpoints.backupJob = async () => ({ id: 'job-media', state: 'done' });
  await button(host, '立即备份').fire('click');
  assert.equal(payload.include_media, false);
  assert(payload.components.includes('workspace'));
});

test('restore preview failure leaves restore disabled and reports the error', async () => {
  const host = await backupSettings();
  endpoints.backupStatus = async () => ({ directory: '/tmp/backups', files: [
    { filename: 'legacy.zip', size: 20, created_at: 1 },
  ], jobs: [] });
  // Refresh replaces the status used by the panel on the next render.
  await button(host, '刷新').fire('click');
  endpoints.backupVerify = async () => ({ ok: true, components: [
    { id: 'chats', label: '聊天记录', archive_bytes: 100, target_bytes: 50,
      files: 2, overwrite_files: 1, delete_files: 0, available: true, restorable: true },
  ] });
  await button(host, '选择恢复').fire('click');
  endpoints.backupRestorePreview = async () => { throw new Error('archive changed'); };
  await button(host, '预览所选恢复内容').fire('click');
  assert(host.textContent.includes('恢复预览失败：archive changed'));
  assert.equal(button(host, '立即恢复').disabled, true);
});

test('selective restore shows sizes, requires preview phrase and polls the restore job', async () => {
  const host = await backupSettings();
  endpoints.backupStatus = async () => ({ directory: '/tmp/backups', files: [
    { filename: 'full.zip', size: 4096, created_at: 1 },
  ], jobs: [] });
  await button(host, '刷新').fire('click');
  endpoints.backupVerify = async () => ({ ok: true, components: [
    { id: 'config', label: '配置', archive_bytes: 100, target_bytes: 50,
      files: 1, overwrite_files: 1, delete_files: 0, available: true, restorable: true },
    { id: 'chats', label: '聊天记录', archive_bytes: 1000, target_bytes: 500,
      files: 2, overwrite_files: 1, delete_files: 0, available: true, restorable: true },
  ] });
  await button(host, '选择恢复').fire('click');
  assert(host.textContent.includes('备份 100 B'));
  assert(host.textContent.includes('当前 500 B'));
  let previewPayload;
  endpoints.backupRestorePreview = async (payload) => {
    previewPayload = payload;
    return { ok: true, filename: 'full.zip', confirmation_phrase: '恢复备份',
      components: [
        { id: 'config', label: '配置', archive_bytes: 100, target_bytes: 50,
          files: 1, overwrite_files: 1, delete_files: 0 },
        { id: 'chats', label: '聊天记录', archive_bytes: 1000, target_bytes: 500,
          files: 2, overwrite_files: 1, delete_files: 0 },
      ], total_archive_bytes: 1100, total_target_bytes: 550, warnings: [] };
  };
  await button(host, '预览所选恢复内容').fire('click');
  assert.deepEqual(previewPayload, { filename: 'full.zip', components: ['config', 'chats'] });
  assert(host.textContent.includes('0 删除'));
  const restore = button(host, '立即恢复');
  assert.equal(restore.disabled, true);
  const confirmation = find(host, (node) => node.tagName === 'input' && node.type === 'text');
  confirmation.value = '恢复备份';
  await confirmation.fire('input');
  assert.equal(restore.disabled, false);
  let restorePayload;
  endpoints.backupRestore = async (payload) => {
    restorePayload = payload;
    return { id: 'restore-1', state: 'queued', operation: 'restore', rollback_filename: 'rollback.zip' };
  };
  endpoints.backupRestoreJob = async () => ({ id: 'restore-1', state: 'done', operation: 'restore', rollback_filename: 'rollback.zip',
    component_progress: { config: { bytes: 100, files: 1 }, chats: { bytes: 1000, files: 2 } } });
  await restore.fire('click');
  assert.deepEqual(restorePayload, {
    filename: 'full.zip', components: ['config', 'chats'], confirmation: '恢复备份',
  });
  await settle();
  await settle();
  assert(host.textContent.includes('rollback.zip'));
  assert(host.textContent.includes('恢复完成；回滚备份：rollback.zip'));
  const progressTable = find(host, (node) => node.tagName === 'table' && node.textContent.includes('预计大小'));
  assert(progressTable, 'completed restore retains per-category usage after refreshing status');
  const chatRow = find(progressTable, (node) => node.tagName === 'tr' && node.textContent.includes('聊天记录'));
  assert.equal(chatRow.textContent, '聊天记录1000 B1000 B1000 B');
});

async function readyToRestore(host) {
  await openRestoreSelection(host, ['full.zip']);
  endpoints.backupRestorePreview = async ({ filename, components }) => ({
    ok: true, filename, confirmation_phrase: '恢复备份',
    components: components.map((id) => ({ id, label: id, archive_bytes: 100, target_bytes: 50 })),
    total_archive_bytes: 200, total_target_bytes: 100, warnings: [],
  });
  await button(host, '预览所选恢复内容').fire('click');
  const confirmation = find(host, (node) => node.tagName === 'input' && node.type === 'text');
  confirmation.value = '恢复备份';
  await confirmation.fire('input');
}

test('restore submission and execution block backup creation across edits and refreshes', async () => {
  const host = await backupSettings();
  await readyToRestore(host);
  const submitGate = deferred();
  const jobGate = deferred();
  endpoints.backupRestore = async () => submitGate.promise;
  endpoints.backupRestoreJob = async () => jobGate.promise;
  let backupCalls = 0;
  endpoints.backupStart = async () => { backupCalls++; throw new Error('must stay blocked'); };
  const pending = button(host, '立即恢复').fire('click');
  assert.equal(button(host, '立即备份').disabled, true);
  const workspace = find(host, (node) => node.tagName === 'label' && node.textContent.startsWith('工作区'));
  const workspaceCheckbox = checkbox(workspace);
  workspaceCheckbox.checked = false;
  await workspaceCheckbox.fire('change');
  await button(host, '刷新').fire('click');
  assert.equal(button(host, '立即备份').disabled, true);
  await button(host, '立即备份').fire('click');
  assert.equal(backupCalls, 0);

  submitGate.resolve({ id: 'restore-pending', state: 'queued', operation: 'restore' });
  await pending;
  await button(host, '刷新').fire('click');
  assert.equal(button(host, '立即备份').disabled, true);
  jobGate.resolve({ id: 'restore-pending', state: 'done', operation: 'restore', rollback_filename: 'saved.zip' });
  await settle();
  await settle();
  assert.equal(button(host, '立即备份').disabled, false);
  assert(host.textContent.includes('恢复完成；回滚备份：saved.zip'));
});

test('backup submission cannot be duplicated and blocks an already previewed restore', async () => {
  const host = await backupSettings();
  await readyToRestore(host);
  const submitGate = deferred();
  const jobGate = deferred();
  let calls = 0;
  endpoints.backupStart = async () => { calls++; return submitGate.promise; };
  endpoints.backupJob = async () => jobGate.promise;
  const pending = button(host, '立即备份').fire('click');
  const workspace = find(host, (node) => node.tagName === 'label' && node.textContent.startsWith('工作区'));
  const workspaceCheckbox = checkbox(workspace);
  workspaceCheckbox.checked = false;
  await workspaceCheckbox.fire('change');
  await button(host, '刷新').fire('click');
  assert.equal(button(host, '立即备份').disabled, true);
  assert.equal(button(host, '立即恢复').disabled, true);
  await button(host, '立即备份').fire('click');
  assert.equal(calls, 1);
  submitGate.resolve({ id: 'backup-pending', state: 'running', operation: 'backup' });
  await pending;
  jobGate.resolve({ id: 'backup-pending', state: 'done', operation: 'backup' });
  await settle();
  await settle();
  assert.equal(button(host, '立即备份').disabled, false);
});

test('status-discovered active restore uses restore polling and locks conflicting operations', async () => {
  const host = await backupSettings();
  const jobGate = deferred();
  let activeRestore = { id: 'discovered', state: 'running', operation: 'restore', stage: 'restoring',
    total_bytes: 1234, progress: 600, component_progress: { config: { bytes: 600, files: 1 } } };
  endpoints.backupStatus = async () => ({ directory: '/tmp/backups', files: [], jobs: [], active_restore: activeRestore });
  let polled;
  endpoints.backupRestoreJob = async (id) => { polled = id; return jobGate.promise; };
  await button(host, '刷新').fire('click');
  assert.equal(polled, 'discovered');
  assert.equal(button(host, '立即备份').disabled, true);
  assert(host.textContent.includes('恢复文件'));
  activeRestore = null;
  jobGate.resolve({ id: 'discovered', state: 'done', operation: 'restore', rollback_filename: 'discovered-backup.zip' });
  await settle();
  await settle();
  assert.equal(button(host, '立即备份').disabled, false);
  assert(host.textContent.includes('discovered-backup.zip'));
});

test('restore preview is discarded when categories change while the request is pending', async () => {
  const host = await backupSettings();
  await openRestoreSelection(host, ['full.zip']);
  const firstPreview = deferred();
  let previewCalls = 0;
  endpoints.backupRestorePreview = async (payload) => {
    previewCalls++;
    if (previewCalls === 1) {
      assert.deepEqual(payload, { filename: 'full.zip', components: ['config', 'chats'] });
      return firstPreview.promise;
    }
    assert.deepEqual(payload, { filename: 'full.zip', components: ['config'] });
    return { ok: true, filename: 'full.zip', confirmation_phrase: '恢复备份',
      components: [{ id: 'config', label: '配置', archive_bytes: 100, target_bytes: 50,
        files: 1, overwrite_files: 1, delete_files: 0 }],
      total_archive_bytes: 100, total_target_bytes: 50, warnings: [] };
  };
  const pending = button(host, '预览所选恢复内容').fire('click');
  const restorePanel = find(host, (node) => node.classList?.contains('backup-restore-panel'));
  const chats = find(restorePanel, (node) => node.tagName === 'label'
    && node.textContent.includes('聊天记录'));
  const chatsCheckbox = find(chats, (node) => node.tagName === 'input');
  chatsCheckbox.checked = false;
  await chatsCheckbox.fire('change');
  firstPreview.resolve({ ok: true, filename: 'full.zip', confirmation_phrase: '恢复备份',
    components: [
      { id: 'config', label: '配置', archive_bytes: 100, target_bytes: 50 },
      { id: 'chats', label: '聊天记录', archive_bytes: 1000, target_bytes: 500 },
    ], total_archive_bytes: 1100, total_target_bytes: 550, warnings: [] });
  await pending;
  assert(!host.textContent.includes('预览完成。核对覆盖范围后输入确认短语。'));
  assert.equal(button(host, '立即恢复').disabled, true);
  assert.equal(find(host, (node) => node.tagName === 'input' && node.type === 'text').value, '');

  await button(host, '预览所选恢复内容').fire('click');
  assert(host.textContent.includes('预览完成。核对覆盖范围后输入确认短语。'));
  const confirmation = find(host, (node) => node.tagName === 'input' && node.type === 'text');
  confirmation.value = '恢复备份';
  await confirmation.fire('input');
  let submitted;
  endpoints.backupRestore = async (payload) => {
    submitted = payload;
    return { id: 'restore-selection', state: 'queued', operation: 'restore' };
  };
  endpoints.backupRestoreJob = async () => ({ id: 'restore-selection', state: 'done', operation: 'restore' });
  await button(host, '立即恢复').fire('click');
  assert.deepEqual(submitted, {
    filename: 'full.zip', components: ['config'], confirmation: '恢复备份',
  });
});

test('restore preview is discarded when another backup is selected while pending', async () => {
  const host = await backupSettings();
  const chooser = await openRestoreSelection(host, ['first.zip', 'second.zip']);
  const firstPreview = deferred();
  endpoints.backupRestorePreview = async (payload) => {
    assert.deepEqual(payload, { filename: 'first.zip', components: ['config', 'chats'] });
    return firstPreview.promise;
  };
  const pending = button(host, '预览所选恢复内容').fire('click');
  await chooser('second.zip').fire('click');
  firstPreview.resolve({ ok: true, filename: 'first.zip', confirmation_phrase: '恢复备份',
    components: [
      { id: 'config', label: '配置', archive_bytes: 100, target_bytes: 50 },
      { id: 'chats', label: '聊天记录', archive_bytes: 1000, target_bytes: 500 },
    ], total_archive_bytes: 1100, total_target_bytes: 550, warnings: [] });
  await pending;
  const restorePanel = find(host, (node) => node.classList?.contains('backup-restore-panel'));
  assert(restorePanel.textContent.includes('恢复备份：second.zip'));
  const confirmation = find(restorePanel, (node) => node.tagName === 'input' && node.type === 'text');
  confirmation.value = '恢复备份';
  await confirmation.fire('input');
  assert.equal(button(restorePanel, '立即恢复').disabled, true);
  assert.equal(button(restorePanel, '预览所选恢复内容').disabled, false);
  let submitted;
  endpoints.backupRestorePreview = async (payload) => {
    assert.equal(payload.filename, 'second.zip');
    return { ok: true, filename: 'second.zip', confirmation_phrase: '恢复备份',
      components: payload.components.map((id) => ({ id, archive_bytes: 50, target_bytes: 25 })),
      total_archive_bytes: 100, total_target_bytes: 50, warnings: [] };
  };
  await button(restorePanel, '预览所选恢复内容').fire('click');
  confirmation.value = '恢复备份';
  await confirmation.fire('input');
  endpoints.backupRestore = async (payload) => {
    submitted = payload;
    return { id: 'restore-file', state: 'queued', operation: 'restore' };
  };
  endpoints.backupRestoreJob = async () => ({ id: 'restore-file', state: 'done', operation: 'restore' });
  await button(restorePanel, '立即恢复').fire('click');
  assert.deepEqual(submitted, {
    filename: 'second.zip', components: ['config', 'chats'], confirmation: '恢复备份',
  });
});
