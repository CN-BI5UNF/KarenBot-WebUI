// 黑白名单页 —— 白名单和黑名单统一管理。
//
// 分工仍然是：
//   白名单 = 决定「谁能用」（mode=whitelist 时严格按名单）
//   黑名单 = 决定「谁永远不能用」（优先级更高，命中直接丢弃）
// 保存后两端都热更新，不需要重启 Runtime。

import { h, fill, card, empty, field, formatNumber } from '../dom.js';
import { endpoints } from '../api.js';

// 新后端把 ID 统一成字符串：QQ 是数字串，Telegram 用户 ID 是数字，
// Telegram 群/频道 ID 是负数（如 -1001234567890）。前端不再转 Number、
// 也不再过滤负数，只去掉空白项并去重。
function normalizeIds(values) {
  return [...new Set(
    (values || []).map((value) => String(value).trim()).filter(Boolean),
  )];
}

function sortIds(values) {
  return normalizeIds(values).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

function parseIds(raw) {
  return normalizeIds(
    String(raw)
      .replace(/[，、;；\s]+/g, ',')
      .split(','),
  );
}

export async function render(container, ctx) {
  let data = null;
  let dirty = false;
  let busy = false;

  const statusLine = h('p', { class: 'field-help' });
  const modeSelect = h('select', {},
    h('option', { value: 'open' }, 'open（对所有人开放，注意 API 费用）'),
    h('option', { value: 'verify' }, 'verify（陌生人走管理员审核）'),
    h('option', { value: 'whitelist' }, 'whitelist（仅名单内可用）'),
  );
  const blackEnabled = h('input', { type: 'checkbox' });
  const saveBtn = h('button', {
    class: 'btn btn-primary',
    onclick: save,
  }, '保存并立即生效');

  const editors = {};

  function listEditor({ key, title, subtitle, placeholder, getIds, setIds }) {
    const input = h('input', { placeholder });
    const chips = h('div', { class: 'chips' });
    const addBtn = h('button', { class: 'btn' }, '添加');

    function renderChips() {
      const ids = normalizeIds(getIds());
      fill(chips, ...(ids.length
        ? ids.map((id) => h('span', { class: 'chip' }, id,
          h('button', {
            title: '移出名单',
            onclick: () => {
              setIds(normalizeIds(getIds()).filter((item) => item !== id));
              dirty = true;
              renderChips();
              renderStatus();
            },
          }, '×')))
        : [h('span', { class: 'field-help' }, '名单为空')]));
    }

    function add() {
      const ids = parseIds(input.value);
      if (!ids.length) return;
      setIds(sortIds([...getIds(), ...ids]));
      input.value = '';
      dirty = true;
      renderChips();
      renderStatus();
    }

    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      add();
    });
    addBtn.onclick = add;

    const el = card(title, subtitle,
      h('div', { class: 'row' }, input, addBtn),
      h('div', { style: { marginTop: '12px' } }, chips),
    );
    editors[key] = renderChips;
    renderChips();
    return el;
  }

  async function load() {
    try {
      data = await endpoints.accessLists();
      modeSelect.value = data.whitelist?.mode || 'verify';
      blackEnabled.checked = !!data.blacklist?.enabled;
      renderAll();
    } catch (e) {
      fill(container, card('黑白名单', '', empty(`读取失败：${e.message}`)));
      return false;
    }
    return true;
  }

  function renderAll() {
    for (const renderChips of Object.values(editors)) renderChips();
    renderStatus();
  }

  function renderStatus() {
    if (!data) return;
    const whiteMode = modeSelect.value;
    const whiteLabel = {
      open: '白名单未限制入站',
      verify: '陌生人由管理员审核',
      whitelist: '仅白名单内可触发回复',
    }[whiteMode] || whiteMode;
    const whiteQq = data.whitelist?.qq_ids?.length || 0;
    const whiteGroup = data.whitelist?.group_ids?.length || 0;
    const blackQq = data.blacklist?.qq_ids?.length || 0;
    const blackGroup = data.blacklist?.group_ids?.length || 0;
    const blackState = blackEnabled.checked
      ? `黑名单生效中（${formatNumber(blackQq)} 个用户、${formatNumber(blackGroup)} 个群）`
      : `黑名单已关闭（名单保留 ${formatNumber(blackQq + blackGroup)} 项，不拦截）`;
    const warning = whiteMode === 'whitelist' && !whiteQq && !whiteGroup
      ? ' 当前白名单为空，保存后所有入站消息都会被拦截。'
      : '';
    statusLine.textContent = `${whiteLabel}；白名单 ${whiteQq + whiteGroup} 项，`
      + `${blackState}。保存后立即生效，无需重启。${warning}`;
    statusLine.style.color = warning ? 'var(--warning)' : '';
  }

  async function save() {
    if (!data || busy) return;
    const whiteCount = (data.whitelist?.qq_ids?.length || 0)
      + (data.whitelist?.group_ids?.length || 0);
    if (modeSelect.value === 'whitelist' && whiteCount === 0
        && !confirm('当前入站策略是 whitelist，且白名单为空；保存后所有入站消息都会被拦截。确定保存？')) {
      return;
    }
    busy = true;
    saveBtn.disabled = true;
    try {
      const result = await endpoints.saveAccessLists({
        whitelist: {
          mode: modeSelect.value,
          qq_ids: data.whitelist?.qq_ids || [],
          group_ids: data.whitelist?.group_ids || [],
        },
        blacklist: {
          enabled: blackEnabled.checked,
          qq_ids: data.blacklist?.qq_ids || [],
          group_ids: data.blacklist?.group_ids || [],
        },
      });
      data = { ...data, ...result };
      dirty = false;
      renderAll();
      ctx.toast(result.message || '黑白名单已保存', 'ok');
    } catch (e) {
      ctx.toast(e.message, 'error');
    } finally {
      busy = false;
      saveBtn.disabled = false;
    }
  }

  modeSelect.onchange = () => { dirty = true; renderStatus(); };
  blackEnabled.onchange = () => { dirty = true; renderStatus(); };

  const loaded = await load();
  if (!loaded) return {};

  fill(container,
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, '黑白名单'),
        h('p', { class: 'page-desc' },
          '统一管理入站策略、白名单和黑名单。黑名单优先于白名单与管理员审核；'
          + '保存后立即生效。'),
      ),
      h('div', { class: 'row' }, saveBtn),
    ),

    card('白名单', '限制哪些用户或群可以触发回复；仅在 mode=whitelist 时严格生效。'
      + 'ID 同时适用于 QQ 与 Telegram。',
      field('入站策略', modeSelect),
      h('div', { class: 'grid grid-2' },
        listEditor({
          key: 'white_qq',
          title: '白名单用户 ID',
          subtitle: 'mode=whitelist 时，私聊仅响应这些用户。QQ 号是数字；'
            + 'Telegram 用户 ID 也是数字，可直接粘贴。',
          placeholder: '输入用户 ID 后回车，可一次粘贴多个',
          getIds: () => data.whitelist?.qq_ids || [],
          setIds: (ids) => { data.whitelist.qq_ids = ids; },
        }),
        listEditor({
          key: 'white_group',
          title: '白名单群/频道 ID',
          subtitle: 'mode=whitelist 时，仅响应这些群。Telegram 群/频道 ID 是负数，'
            + '例如 -1001234567890。',
          placeholder: '输入群 ID 后回车，可一次粘贴多个',
          getIds: () => data.whitelist?.group_ids || [],
          setIds: (ids) => { data.whitelist.group_ids = ids; },
        }),
      ),
    ),

    card('黑名单', '命中后消息在入站处直接丢弃——不回复、不入库、不消耗 API 费用。',
      h('label', { class: 'switch' }, blackEnabled,
        '启用黑名单（关闭时名单保留但不拦截）'),
      h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
        listEditor({
          key: 'black_qq',
          title: '拉黑的用户 ID',
          subtitle: '私聊直接丢弃；群聊中该成员的发言也不触发回复。'
            + 'Telegram 用户 ID 同样填在这里。',
          placeholder: '输入用户 ID 后回车，可一次粘贴多个',
          getIds: () => data.blacklist?.qq_ids || [],
          setIds: (ids) => { data.blacklist.qq_ids = ids; },
        }),
        listEditor({
          key: 'black_group',
          title: '拉黑的群/频道',
          subtitle: '该群所有消息一律丢弃。Telegram 群/频道 ID 是负数。',
          placeholder: '输入群 ID 后回车，可一次粘贴多个',
          getIds: () => data.blacklist?.group_ids || [],
          setIds: (ids) => { data.blacklist.group_ids = ids; },
        }),
      ),
    ),

    card('优先级', '',
      h('ul', { style: { margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)' } },
        h('li', {}, '黑名单优先级最高：先查黑名单，命中即丢弃，不再看白名单或审核。'),
        h('li', {}, '白名单模式为 open 时对所有人开放，黑名单仍能拦住被拉黑的对象。'),
        h('li', {}, '白名单为空且 mode=whitelist 时，所有入站消息都会被拦截。'),
      ),
      statusLine,
    ),
  );

  return { isDirty: () => dirty };
}
