// 首次配置向导（多步版）。
//
// 对应原桌面端的 ui/wizard/window.py。步骤流转**由后端决定**
// （POST /api/setup/step → webui/wizard/flow.py），前端只渲染当前步、做基础校验、
// 把填好的数据攒在 state 里，最后一次性提交。
//
// 为什么不让前端判断下一步：两条路径（推荐 7 步 / 自定义 8 步）加上
// PERSONA_CREATE 分支，规则写两遍必然漂；flow.py 是原桌面端逐字搬过来的，可信。

import { h, fill, empty } from '../dom.js';
import { icon } from '../icons.js';
import { endpoints } from '../api.js';
import { STEP_VIEWS, buildPayload } from '../setup/steps.js';

export function render(container, ctx) {
  const state = {
    path: 'recommended',
    current: 'welcome',
    isLast: false,
    progress: [0, 1],
    stepsMeta: {},
    presets: [],
    personas: [],
    // 收集中的配置
    provider: {
      id: '', preset: null, model_vendor: null, display_name: '', protocol: 'openai_compat',
      base_url: '', model: '', api_key: '', reasoning_style: '', timeout_seconds: 120,
      has_key: false,
    },
    chat: { temperature: 0.6, top_p: 1.0, max_tokens: 16384, reasoning: false, reasoning_budget: 'medium' },
    agents: {},
    features: {},
    behavior: {},
    adapter: {
      enabled: false, mode: 'client', host: '127.0.0.1', port: 3000, path: '/',
      access_token: '',
      whitelist: { mode: 'verify', qq_ids: [], group_ids: [] },
    },
    persona: '大肥鱼',
    persona_source: 'builtin',
    persona_brief: '',
    // UI
    busy: false,
    error: '',
  };

  const progressBar = h('div', { class: 'wizard-progress-bar' });
  const progressText = h('span', { class: 'field-help' }, '');
  const titleEl = h('h2', { class: 'modal-title' }, '');
  const subtitleEl = h('p', { class: 'modal-sub' }, '');
  const stepHost = h('div', { class: 'wizard-body' });
  const errorBox = h('div', { class: 'gate-error', role: 'alert' });
  const backBtn = h('button', { class: 'btn' }, '上一步');
  const skipBtn = h('button', { class: 'btn btn-text' }, '跳过');
  const nextBtn = h('button', { class: 'btn btn-primary' }, '下一步');

  // 文案表来自 webui/wizard/copy.py（原桌面端逐字复制），按钮措辞与桌面端一致。
  // 拉不到就回落到上面写死的中文——文案接口挂掉不该让用户配不了。
  let COPY = {};

  let view = null;
  let ready = false;
  let disposed = false;
  const visitedSteps = new Set();
  const stepCtx = {
    ...ctx,
    rerender: rerenderStep,
    editStep: (stepId) => {
      if (!visitedSteps.has(stepId)) return;
      return runAction(() => showStep(stepId));
    },
  };

  fill(container,
    h('div', { class: 'wizard' },
      h('div', { class: 'wizard-head' },
        progressBar,
        progressText,
        titleEl,
        subtitleEl,
      ),
      stepHost,
      errorBox,
      h('div', { class: 'wizard-foot' },
        backBtn,
        h('div', { class: 'spacer' }),
        skipBtn,
        nextBtn,
      ),
    ),
  );

  function applyCopy() {
    const text = (key, fallback) => COPY[key] || fallback;
    backBtn.textContent = text('button.back', '上一步');
    skipBtn.textContent = text('button.skip', '跳过');
    if (!state.isLast) nextBtn.textContent = text('button.next', '下一步');
  }

  async function boot() {
    state.busy = true;
    state.error = '';
    renderError();
    stepHost.replaceChildren(h('div', { class: 'field-help' }, '正在准备…'));
    try {
      const options = await endpoints.setupOptions();
      if (disposed) return;
      state.presets = options.presets || [];
      state.personas = options.personas || [];
      for (const step of options.steps || []) state.stepsMeta[step.id] = step;
      const defaults = options.defaults || {};
      state.persona = defaults.persona || '大肥鱼';
      state.provider.timeout_seconds = 120;
      if (defaults.preset) {
        state.provider.preset = defaults.preset;
        state.provider.id = `${defaults.preset}_main`;
      }
      if (defaults.model) state.provider.model = defaults.model;
      const adapter = defaults.adapter || {};
      Object.assign(state.adapter, {
        enabled: adapter.enabled === true,
        mode: adapter.mode || 'client',
        host: adapter.host || '127.0.0.1',
        port: adapter.port || 3000,
        path: adapter.path || '/',
      });
      state.adapter.whitelist.mode = adapter.whitelist_mode || 'verify';
    } catch (e) {
      if (disposed) return;
      state.busy = false;
      fill(stepHost,
        empty('读不到向导选项', { subtitle: e.message, iconName: 'settings' }),
        h('button', { class: 'btn', onclick: boot }, '重新读取向导选项'));
      renderError();
      return;
    }

    try {
      const tables = await endpoints.setupCopy();
      COPY = (tables.wizard && tables.wizard.COPY) || {};
    } catch {
      // 文案拉不到不是阻塞问题，按钮用回落的默认中文
    }
    if (disposed) return;
    ready = true;
    applyCopy();
    await showStep(state.current);
    state.busy = false;
    renderError();
  }

  async function askFlow(direction) {
    try {
      const result = await endpoints.setupStep({
        current: state.current,
        path: state.path,
        direction,
        context: { persona_source: state.persona_source },
      });
      return result;
    } catch (e) {
      state.error = e.message;
      renderError();
      return null;
    }
  }

  function renderError() {
    if (disposed) return;
    errorBox.textContent = state.error || '';
    nextBtn.disabled = state.busy || !ready;
    backBtn.disabled = state.busy || !ready || state.current === 'welcome';
    skipBtn.disabled = state.busy || !ready;
    stepHost.inert = state.busy;
  }

  async function showStep(stepId) {
    if (typeof view?.destroy === 'function') {
      try { view.destroy(); } catch (e) { console.error(e); }
    }

    state.current = stepId;
    state.isLast = stepId === 'summary';
    visitedSteps.add(stepId);
    state.error = '';

    const meta = state.stepsMeta[stepId] || { title: stepId, subtitle: '' };
    titleEl.textContent = meta.title;
    subtitleEl.textContent = meta.subtitle || '';
    skipBtn.classList.toggle('hidden', !meta.can_skip);

    const renderer = STEP_VIEWS[stepId];
    if (!renderer) {
      fill(stepHost, empty(`这一步还没实现：${stepId}`, {
        subtitle: '可以在配置生成后到设置页调整',
        iconName: 'settings',
      }));
      view = { validate: () => null };
    } else {
      view = renderer(stepHost, stepCtx, state) || { validate: () => null };
    }

    await refreshProgress();
    renderError();
  }

  async function refreshProgress() {
    const current = state.current;
    const path = state.path;
    const source = state.persona_source;
    const stillCurrent = () => !disposed && state.current === current
      && state.path === path && state.persona_source === source;
    try {
      const flow = await endpoints.setupStep({
        current,
        path,
        direction: 'next',
        context: { persona_source: source },
      });
      if (!stillCurrent()) return;
      const [index, total] = flow.progress || [0, 1];
      state.isLast = !!flow.is_last;
      progressText.textContent = `第 ${index} / ${total} 步`;
      fill(progressBar, ...Array.from({ length: total }, (_, i) =>
        h('span', { class: `wizard-dot ${i < index ? 'done' : ''}` })));
      nextBtn.textContent = state.isLast
        ? (COPY['summary.start_button'] || '完成配置')
        : (COPY['button.next'] || '下一步');
      skipBtn.classList.toggle('hidden', !(state.stepsMeta[state.current] || {}).can_skip);
    } catch (e) {
      if (!stillCurrent()) return;
      state.error = e.message;
      renderError();
    }
  }

  async function advance() {
    const problem = view?.validate ? view.validate() : null;
    if (problem) {
      state.error = problem;
      renderError();
      return;
    }
    state.error = '';

    if (state.isLast) {
      await submit();
      return;
    }

    const flow = await askFlow('next');
    if (!flow) return;
    if (!flow.next) {
      state.error = '无法确定下一步，请重试或返回上一步。';
      return;
    }
    await showStep(flow.next);
  }

  async function goBack() {
    const flow = await askFlow('prev');
    if (!flow || !flow.prev) return;
    await showStep(flow.prev);
  }

  async function skip() {
    const flow = await askFlow('next');
    if (!flow) return;
    if (!flow.next) {
      state.error = '无法确定下一步，请重试或返回上一步。';
      return;
    }
    await showStep(flow.next);
  }

  async function submit() {
    nextBtn.textContent = '正在写入…';
    renderError();
    try {
      const payload = buildPayload(state);
      const result = await endpoints.setupApply(payload);
      ctx.toast(result.message || '配置已写入', result.started ? 'ok' : 'warn');
      await ctx.onDone();
    } catch (e) {
      state.error = e.message;
    }
  }

  // 导航、写盘期间统一锁定，错误展示不阻止用户修正或重试。
  async function runAction(action) {
    if (state.busy || !ready || disposed) return;
    state.busy = true;
    state.error = '';
    renderError();
    try {
      await action();
    } catch (e) {
      state.error = e.message;
    } finally {
      state.busy = false;
      nextBtn.textContent = state.isLast
        ? (COPY['summary.start_button'] || '完成配置')
        : (COPY['button.next'] || '下一步');
      renderError();
    }
  }

  async function rerenderStep() {
    if (state.busy || disposed) return;
    const renderer = STEP_VIEWS[state.current];
    if (!renderer) return;
    state.error = '';
    if (typeof view?.destroy === 'function') {
      try { view.destroy(); } catch (e) { console.error(e); }
    }
    view = renderer(stepHost, stepCtx, state) || { validate: () => null };
    await refreshProgress();
    renderError();
  }

  // 向导步骤里的选择卡/开关需要局部重渲染；由这里统一更新 view，
  // 避免旧的 validate 闭包和 DOM 状态脱节。
  backBtn.onclick = () => runAction(goBack);
  skipBtn.onclick = () => runAction(skip);
  nextBtn.onclick = () => runAction(advance);
  const clearError = () => {
    if (state.busy || !state.error) return;
    state.error = '';
    renderError();
  };
  stepHost.addEventListener('input', clearError);
  stepHost.addEventListener('change', clearError);

  boot();

  return {
    destroy() {
      disposed = true;
      if (typeof view?.destroy === 'function') view.destroy();
    },
  };
}
