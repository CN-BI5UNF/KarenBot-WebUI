// 设置 → 外部程序：随 KarenBot 启动的旁路程序。
//
// 保存走整表 PUT，后端会热应用：新增/启用立即启动，删除/禁用立即停止
// 仅由 KarenBot 成功拉起的进程。启动失败只影响该程序状态，不影响 Runtime。

import { endpoints } from './api.js';
import { h, fill, card, empty, field, table } from './dom.js';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const STATE_INFO = {
  running: ['运行中', 'badge ok'],
  starting: ['启动中', 'badge idle'],
  restarting: ['重启中', 'badge warn'],
  external: ['外部已运行', 'badge idle'],
  failed: ['启动失败', 'badge bad'],
  exited: ['已退出', 'badge idle'],
  disabled: ['已禁用', 'badge idle'],
  launcher_exited: ['启动器已退出', 'badge warn'],
  stopping: ['停止中', 'badge warn'],
  stopped: ['未运行', 'badge idle'],
};

function stateInfo(state) {
  return STATE_INFO[state] || [state || '未知', 'badge idle'];
}

function toDraft(program) {
  return {
    _existing: Boolean(program.id),
    id: program.id || `program_${Math.random().toString(16).slice(2, 14)}`,
    name: program.name || '',
    enabled: program.enabled !== false,
    executable: program.executable || program.path || '',
    args_text: Array.isArray(program.args) ? program.args.join('\n') : String(program.args || ''),
    cwd: program.cwd || '',
    env_text: Object.entries(program.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'),
    stop_with_karen: program.stop_with_karen !== false,
    probe_host: program.probe_host || '127.0.0.1',
    probe_port: Number(program.probe_port || 0),
    auto_restart: Boolean(program.auto_restart),
    startup_wait_seconds: Number(program.startup_wait_seconds ?? 2),
  };
}

function parseEnv(text) {
  const env = {};
  for (const [index, raw] of String(text || '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) throw new Error(`环境变量第 ${index + 1} 行缺少 "="`);
    const key = line.slice(0, eq).trim();
    if (!key) throw new Error(`环境变量第 ${index + 1} 行缺少变量名`);
    env[key] = line.slice(eq + 1).trim();
  }
  return env;
}

function payloadFor(program) {
  return {
    id: program.id,
    name: program.name.trim(),
    enabled: Boolean(program.enabled),
    executable: program.executable.trim(),
    args: program.args_text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    cwd: program.cwd.trim(),
    env: parseEnv(program.env_text),
    stop_with_karen: Boolean(program.stop_with_karen),
    probe_host: program.probe_host.trim() || '127.0.0.1',
    probe_port: Number(program.probe_port || 0),
    auto_restart: Boolean(program.auto_restart),
    startup_wait_seconds: Number(program.startup_wait_seconds ?? 2),
  };
}

function switchField(label, checked, onChange) {
  return h('label', { class: 'switch' },
    h('input', {
      type: 'checkbox',
      checked: Boolean(checked),
      onchange: (event) => onChange(event.target.checked),
    }),
    label,
  );
}

export function renderProgramsPanel(container, ctx, options = {}) {
  let programs = [];
  let baseline = '[]';
  let statusById = {};
  let loaded = false;
  let saving = false;
  let dirty = false;
  let rowStatusEls = [];

  const statusHost = h('div', {});
  const marker = h('span', { class: 'badge warn' }, '未保存');
  marker.style.display = 'none';
  const saveBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    disabled: true,
    onclick: () => save(),
  }, '保存并应用');
  const addBtn = h('button', {
    class: 'btn',
    type: 'button',
    onclick: () => {
      programs.push(toDraft({ enabled: true, stop_with_karen: true }));
      renderRows();
      notifyDirty();
    },
  }, '添加程序');
  const refreshBtn = h('button', {
    class: 'btn',
    type: 'button',
    onclick: () => refreshStatus().then(() => ctx.toast('状态已刷新', 'ok')),
  }, '刷新状态');
  const statusLine = h('p', { class: 'field-help' }, '');
  const listHost = h('div', { class: 'program-list' });

  const editor = card('外部程序', '启动失败只记录错误并提醒，不会影响 KarenBot 正常运行。', h('div', { class: 'row-wrap' },
    addBtn,
    refreshBtn,
    h('div', { class: 'spacer' }),
    marker,
    saveBtn,
  ));
  editor.append(
    h('p', { class: 'field-help' },
      '程序以 KarenBot 的用户权限运行；参数不经过 shell，不支持管道和重定向。'
      + '“随 KarenBot 关闭”只影响由 Karen 成功拉起且仍存活的进程；启动失败或端口上已有外部实例永远不会被停止。'
      + 'Windows 的 .bat/.cmd 若只是启动器，Karen 无法跟踪其子进程，建议直接填 .exe。'),
    listHost,
    statusLine,
  );

  fill(container, statusHost, editor);
  load();

  // ------------------------------------------------------------------
  // Load / status
  // ------------------------------------------------------------------
  async function load() {
    loaded = false;
    saveBtn.disabled = true;
    addBtn.disabled = true;
    fill(listHost, empty('加载中…'));
    try {
      const data = await endpoints.programs();
      if (!container.isConnected) return;
      applyData(data);
    } catch (error) {
      if (!container.isConnected) return;
      renderLoadError(error);
    }
  }

  function applyData(data) {
    programs = (data.programs || []).map(toDraft);
    baseline = JSON.stringify(programs);
    statusById = Object.fromEntries(
      (data.status || []).filter((item) => item && item.id).map((item) => [item.id, item]),
    );
    loaded = true;
    addBtn.disabled = false;
    renderStatusCard();
    renderRows();
    notifyDirty(true);
  }

  function renderLoadError(error) {
    loaded = false;
    saveBtn.disabled = true;
    addBtn.disabled = true;
    fill(listHost, card('读取外部程序失败', '', empty(String(error.message || error)),
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => load(),
      }, '重试')));
  }

  async function refreshStatus() {
    if (!loaded || saving) return;
    try {
      const data = await endpoints.programs();
      if (!container.isConnected) return;
      statusById = Object.fromEntries(
        (data.status || []).filter((item) => item && item.id).map((item) => [item.id, item]),
      );
      renderStatusCard();
      for (const entry of rowStatusEls) {
        if (entry && entry.el && entry.el.isConnected) renderRowStatus(entry.el, entry.program);
      }
    } catch (error) {
      if (container.isConnected) ctx.toast(`刷新状态失败：${error.message || error}`, 'error');
    }
  }

  function renderStatusCard() {
    fill(statusHost, null);
    const rows = [];
    for (const program of programs) {
      const item = statusById[program.id];
      if (!item) {
        rows.push(h('tr', {},
          h('td', {}, program.name || program.id),
          h('td', {}, h('span', { class: 'badge idle' }, '未保存')),
          h('td', { class: 'field-help' }, '保存后显示运行状态'),
        ));
        continue;
      }
      const [text, cls] = stateInfo(item.state);
      const detail = [];
      if (item.pid) detail.push(`PID ${item.pid}`);
      if (item.managed) detail.push('由 Karen 启动');
      if (item.state === 'external') detail.push('外部实例，不接管');
      if (item.restarts) detail.push(`自动重启 ${item.restarts} 次`);
      if (item.error) detail.push(item.error);
      rows.push(h('tr', {},
        h('td', {}, item.name || program.name || program.id),
        h('td', {}, h('span', { class: cls }, text)),
        h('td', { class: 'field-help', style: { wordBreak: 'break-all' } }, detail.join(' · ') || '—'),
      ));
    }
    const body = rows.length
      ? table(['程序', '状态', '详情'], rows)
      : empty('还没有外部程序。');
    fill(statusHost, card('运行状态', 'KarenBot 拉起的程序及最近一次启动结果', body));
  }

  // ------------------------------------------------------------------
  // Editor rows
  // ------------------------------------------------------------------
  function renderRows() {
    rowStatusEls = [];
    fill(listHost, null);
    if (!programs.length) {
      listHost.append(empty('还没有外部程序。点击「添加程序」配置 NapCat、旁路服务或其他启动项。'));
      return;
    }
    programs.forEach((program, index) => {
      const row = renderProgramRow(program, index);
      listHost.append(row);
    });
  }

  function input(value, oninput, extra = {}) {
    return h('input', { value: value ?? '', oninput: (event) => { oninput(event.target.value); notifyDirty(); }, ...extra });
  }

  function textarea(value, oninput, extra = {}) {
    return h('textarea', {
      rows: 3,
      value: value ?? '',
      oninput: (event) => { oninput(event.target.value); notifyDirty(); },
      ...extra,
    });
  }

  function renderProgramRow(program, index) {
    const statusEl = h('div', { class: 'program-status' });
    rowStatusEls.push({ el: statusEl, program });

    const idInput = h('input', {
      value: program.id,
      readOnly: Boolean(program._existing),
      oninput: (event) => { program.id = event.target.value; notifyDirty(); },
    });
    const nameInput = input(program.name, (value) => { program.name = value; }, { placeholder: '显示名称（可留空）' });
    const exeInput = input(program.executable, (value) => { program.executable = value; }, { placeholder: '可执行文件或启动脚本路径' });
    const argsInput = textarea(program.args_text, (value) => { program.args_text = value; }, {
      placeholder: '一行一个参数',
    });
    const cwdInput = input(program.cwd, (value) => { program.cwd = value; }, { placeholder: '留空使用程序所在目录' });
    const envInput = textarea(program.env_text, (value) => { program.env_text = value; }, {
      placeholder: 'KEY=VALUE\n一行一个',
    });
    const probeHostInput = input(program.probe_host, (value) => { program.probe_host = value; }, { placeholder: '127.0.0.1' });
    const probePortInput = h('input', {
      type: 'number',
      min: 0,
      max: 65535,
      value: program.probe_port,
      oninput: (event) => { program.probe_port = Number(event.target.value || 0); notifyDirty(); },
    });
    const waitInput = h('input', {
      type: 'number',
      min: 0,
      max: 300,
      step: 0.5,
      value: program.startup_wait_seconds,
      oninput: (event) => { program.startup_wait_seconds = Number(event.target.value || 0); notifyDirty(); },
    });

    const advanced = h('details', { class: 'advanced-settings' },
      h('summary', {}, '高级设置'),
      field('环境变量', envInput, '一行一个 KEY=VALUE；值以明文保存在 config.yaml。'),
      h('div', { class: 'grid grid-2' },
        field('探测地址', probeHostInput, '端口已监听则跳过启动。'),
        field('探测端口', probePortInput, '0 表示不探测。'),
      ),
      h('div', { class: 'row-wrap' },
        switchField('异常退出后自动重启', program.auto_restart, (checked) => { program.auto_restart = checked; }),
        field('启动等待（秒）', waitInput, '0 表示不等待。'),
      ),
    );
    if (program.env_text || program.probe_port || program.auto_restart || Number(program.startup_wait_seconds) !== 2) {
      advanced.open = true;
    }

    const head = h('div', { class: 'program-head' },
      h('div', { class: 'program-title' }, nameInput),
      h('span', { class: 'field-help' }, 'ID'),
      idInput,
      h('div', { class: 'spacer' }),
      switchField('启用', program.enabled, (checked) => { program.enabled = checked; notifyDirty(); }),
      switchField('随 KarenBot 关闭', program.stop_with_karen, (checked) => { program.stop_with_karen = checked; notifyDirty(); }),
      h('button', {
        class: 'btn btn-sm btn-danger',
        type: 'button',
        onclick: () => removeProgram(index),
      }, '移除'),
    );

    const row = h('div', { class: 'program-card', dataset: { index: String(index) } },
      head,
      field('可执行文件', exeInput, '绝对路径或 PATH 中的命令名；保存时不检查文件是否存在。'),
      field('启动参数', argsInput, '一行一个参数，不按逗号拆分。'),
      field('工作目录', cwdInput),
      advanced,
      statusEl,
    );
    renderRowStatus(statusEl, program);
    return row;
  }

  function renderRowStatus(el, program) {
    const item = statusById[program.id];
    fill(el, null);
    if (!item) {
      el.append(h('span', { class: 'badge idle' }, '未保存'));
      return;
    }
    const [text, cls] = stateInfo(item.state);
    const line = h('div', { class: 'row-wrap' },
      h('span', { class: cls }, text),
      item.pid ? h('span', { class: 'field-help' }, `PID ${item.pid}`) : null,
      item.managed ? h('span', { class: 'field-help' }, '由 Karen 启动') : null,
      h('div', { class: 'spacer' }),
    );
    if (program._existing && item.enabled) {
      if (item.managed) {
        line.append(h('button', {
          class: 'btn btn-sm', type: 'button',
          onclick: () => action(program.id, 'stop'),
        }, '停止'));
      } else if (['failed', 'stopped', 'exited', 'launcher_exited'].includes(item.state)) {
        line.append(h('button', {
          class: 'btn btn-sm', type: 'button',
          onclick: () => action(program.id, 'start'),
        }, item.state === 'failed' ? '重试' : '启动'));
      }
    }
    el.append(line);
    if (item.error) {
      el.append(h('p', { class: 'field-help', style: { color: 'var(--bad, #b42318)', wordBreak: 'break-all' } },
        item.error));
    }
  }

  // ------------------------------------------------------------------
  // Actions / save
  // ------------------------------------------------------------------
  async function action(programId, verb) {
    if (saving) return;
    try {
      const result = verb === 'start'
        ? await endpoints.startProgram(programId)
        : await endpoints.stopProgram(programId);
      if (!container.isConnected) return;
      if (result.program) statusById[programId] = result.program;
      renderStatusCard();
      for (const entry of rowStatusEls) {
        if (entry && entry.el && entry.el.isConnected) renderRowStatus(entry.el, entry.program);
      }
      const failed = verb === 'start' && result.started === false;
      ctx.toast(result.message || (failed ? '启动失败' : '操作已完成'), failed ? 'error' : 'ok');
    } catch (error) {
      if (container.isConnected) ctx.toast(`${verb === 'start' ? '启动' : '停止'}失败：${error.message || error}`, 'error');
    }
  }

  function removeProgram(index) {
    const program = programs[index];
    const item = statusById[program.id];
    const managed = Boolean(item && item.managed);
    if (managed && !confirm(`「${program.name || program.id}」由 KarenBot 拉起且仍在运行。移除并保存后它会被立即停止，继续？`)) {
      return;
    }
    programs.splice(index, 1);
    renderRows();
    notifyDirty();
  }

  function collect() {
    const seen = new Set();
    return programs.map((program) => {
      if (!ID_RE.test(program.id || '')) {
        throw new Error(`程序 ID ${program.id || '(空)'} 不合法：只能使用字母、数字、下划线和短横线`);
      }
      if (seen.has(program.id)) throw new Error(`程序 ID 重复：${program.id}`);
      seen.add(program.id);
      if (program.enabled && !program.executable.trim()) {
        throw new Error(`程序 ${program.id} 已启用，但可执行文件为空`);
      }
      return payloadFor(program);
    });
  }

  async function save() {
    if (!loaded || saving) return;
    let payload;
    try {
      payload = collect();
    } catch (error) {
      statusLine.textContent = error.message;
      ctx.toast(error.message, 'error');
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    statusLine.textContent = '正在保存并应用…';
    try {
      const result = await endpoints.savePrograms({ programs: payload });
      if (!container.isConnected) return;
      programs = (result.programs || []).map(toDraft);
      baseline = JSON.stringify(programs);
      statusById = Object.fromEntries(
        (result.status || []).filter((item) => item && item.id).map((item) => [item.id, item]),
      );
      loaded = true;
      renderStatusCard();
      renderRows();
      notifyDirty(true);
      statusLine.textContent = '';
      ctx.toast(result.message || '外部程序配置已保存', 'ok');
      if (result.needs_restart) options.markRestart?.();
      for (const [programId, error] of Object.entries(result.errors || {})) {
        ctx.toast(`程序 ${programId}：${error}`, 'error');
      }
    } catch (error) {
      if (!container.isConnected) return;
      statusLine.textContent = `保存失败：${error.message || error}`;
      ctx.toast(`保存失败：${error.message || error}`, 'error');
    } finally {
      saving = false;
      saveBtn.disabled = !loaded || !dirty;
    }
  }

  function notifyDirty() {
    if (!loaded) return;
    const next = JSON.stringify(programs) !== baseline;
    if (next !== dirty) {
      dirty = next;
      options.onDirtyChange?.(dirty);
    }
    marker.style.display = dirty ? '' : 'none';
    saveBtn.disabled = !dirty || saving;
  }
}
