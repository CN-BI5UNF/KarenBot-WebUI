// 渠道 / 协议面板 —— 设置页的「渠道与协议」分页。
//
// 数据全部来自本轮新增的后端接口：
//   GET /api/adapters/protocols  协议卡片 + AdapterConfig 的 JSON Schema
//   GET /api/adapters/config     当前适配器完整配置（密钥只返回引用 ID）
//   PUT /api/adapters/{name}     整份保存并热重载
//   GET /api/adapters/status     连接状态 + 能力表
//   GET /api/adapters/docs/{id}  协议介绍 Markdown
//
// 前端不硬编码协议知识：协议卡片用 protocols[]，表单字段用
// config_schema.$defs[protocol.config_model]，能力显隐用 capabilities。

import { h, fill, card, empty, modal } from './dom.js';
import { endpoints } from './api.js';
import {
  adapterDialectLabel, adapterEndpoint, adapterTransportLabel, adapterTypeLabel,
} from './adapter_view.js';

const PROTOCOL_STATUS = {
  stable: { label: '稳定', cls: 'ok' },
  beta: { label: 'Beta', cls: 'warn' },
  planned: { label: '即将支持', cls: 'idle' },
};

// 这些字段只存 SecretsManager 的引用 ID，不能把密钥本身填进来。
const SECRET_FIELDS = new Set([
  'access_token_id',
  'webhook_secret_id',
  'bot_token_id',
  'webhook_secret_token_id',
]);

const OPTION_LABELS = {
  transport: {
    ws_client: 'WebSocket 客户端（Karen 连协议端）',
    ws_server: 'WebSocket 服务端（协议端连 Karen）',
    http: 'HTTP API + Webhook',
    long_polling: '长轮询（Long Polling，无需公网）',
    webhook: 'Webhook（需要公网 HTTPS 回调）',
  },
  dialect: {
    auto: '自动（napcat 类型用 NapCat 方言）',
    napcat: 'NapCatQQ',
    llonebot: 'LLOneBot',
    lagrange: 'Lagrange.OneBot',
    gocqhttp: 'go-cqhttp',
    generic: '通用标准（只调标准 API）',
  },
  message_format: {
    array: '数组（推荐，避免 CQ 转义问题）',
    string: 'CQ 字符串（兼容极旧实现端）',
  },
  parse_mode: {
    HTML: 'HTML',
    MarkdownV2: 'MarkdownV2',
    none: '纯文本',
  },
};

const ONEBOT_LABELS = {
  enabled: '启用渠道',
  transport: '接入方式',
  dialect: '协议端方言',
  message_format: '消息格式',
  host: '地址',
  port: '端口',
  path: '路径',
  http_api_url: 'HTTP API 地址',
  webhook_enabled: '启用 HTTP 事件上报',
  webhook_host: 'Webhook 监听地址',
  webhook_port: 'Webhook 端口',
  webhook_path: 'Webhook 路径',
  webhook_secret_id: 'Webhook 密钥',
  access_token_id: 'Access Token',
  reconnect_interval_seconds: '常规重连间隔（秒）',
  max_reconnect_attempts: '最大重连次数',
  reconnect_backoff_max_seconds: '退避上限（秒）',
  ping_interval_seconds: '心跳间隔（秒）',
  ping_timeout_seconds: '心跳超时（秒）',
  initial_connect_timeout_seconds: '首次连接超时（秒）',
  startup_connect_timeout_seconds: '启动时等待首次连接（秒）',
  api_timeout_seconds: 'API 超时（秒）',
  api_wait_connected_timeout_seconds: '等连接再发 API 的上限（秒）',
  fast_reconnect_attempts: '快速重试次数',
  fast_reconnect_interval_seconds: '快速重试间隔（秒）',
  reconnect_jitter_seconds: '重连抖动（秒）',
  voice_fetch_delay_seconds: '语音转写等待（秒）',
};

const TELEGRAM_LABELS = {
  enabled: '启用渠道',
  transport: '接入方式',
  bot_token_id: 'Bot Token',
  api_base: 'Bot API 基址',
  proxy: '代理',
  webhook_host: 'Webhook 监听地址',
  webhook_port: 'Webhook 端口',
  webhook_path: 'Webhook 路径',
  webhook_public_url: '公网回调 URL',
  webhook_secret_token_id: 'Webhook 密钥',
  parse_mode: '解析模式',
  allowed_updates: '订阅事件',
  drop_pending_updates: '丢弃积压更新',
  polling_timeout_seconds: '长轮询等待（秒）',
  api_timeout_seconds: 'API 超时（秒）',
  reconnect_interval_seconds: '重连间隔（秒）',
};

// 与 GUI（gui/adapter_spec.py）保持同一套 core / advanced 分组：
// core 直接展示；advanced 收进默认折叠的「高级与 Webhook 设置」。
// 未列出的字段不渲染，但保存时仍会带上当前值/默认值，不会被重置。
const FIELD_GROUPS = {
  onebot: {
    core: [
      'enabled', 'transport', 'dialect', 'message_format',
      'host', 'port', 'path', 'access_token_id',
    ],
    advanced: [
      'http_api_url', 'webhook_enabled', 'webhook_host', 'webhook_port',
      'webhook_path', 'webhook_secret_id', 'reconnect_interval_seconds',
      'ping_interval_seconds', 'ping_timeout_seconds', 'api_timeout_seconds',
    ],
  },
  telegram: {
    core: [
      'enabled', 'transport', 'bot_token_id', 'api_base', 'proxy', 'parse_mode',
    ],
    advanced: [
      'webhook_host', 'webhook_port', 'webhook_path', 'webhook_public_url',
      'webhook_secret_token_id', 'drop_pending_updates',
      'polling_timeout_seconds', 'api_timeout_seconds',
      'reconnect_interval_seconds', 'allowed_updates',
    ],
  },
};

const CAPABILITY_LABELS = {
  send_image: '图片',
  send_voice: '语音',
  send_video: '视频',
  upload_file: '文件',
  recall: '撤回',
  reply: '回复',
  mention: '@提及',
  poke: '戳一戳',
  emoji_reaction: '表情回应',
  voice_stt: '语音转写',
  forward_read: '合并转发',
  group_history: '群历史',
  get_message: '消息详情',
  list_friends: '好友列表',
  list_groups: '群列表',
  list_group_members: '群成员',
  friend_request: '好友请求',
  group_request: '群请求',
  group_admin: '群管理',
  proactive_private: '主动私聊',
  proactive_group: '主动群聊',
};

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function trimHelp(text, limit = 320) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function fieldBlock(labelText, control, help = '') {
  return h('div', { class: 'field-block' },
    h('span', { class: 'field-label' }, labelText),
    control,
    help ? h('div', { class: 'field-help' }, help) : null,
  );
}

function schemaType(spec) {
  if (!spec) return 'string';
  if (Array.isArray(spec.enum)) return 'enum';
  if (spec.type) return spec.type;
  // Pydantic 的 Optional[str] 会生成 anyOf: [{type:'string'}, {type:'null'}]
  if (Array.isArray(spec.anyOf)) {
    const nonNull = spec.anyOf.find((item) => item && item.type && item.type !== 'null');
    if (nonNull) return nonNull.type;
  }
  return 'string';
}

function isSecretField(key) {
  if (SECRET_FIELDS.has(key)) return true;
  // 兼容后端将来新增的 xxx_token_id / xxx_secret_id 字段；
  // 普通业务字段（如 provider 的 *_id）不要误判成密钥引用。
  return /_id$/.test(key) && /(token|secret)/.test(key);
}

function optionLabel(key, value) {
  return OPTION_LABELS[key]?.[value] || String(value);
}

function buildLabelMap(groups) {
  const map = {};
  for (const group of groups || []) {
    for (const item of group.fields || []) {
      const path = String(item.path || '');
      // 只取渠道字段的标签。其它分页也有 enabled/host/path 这类同名键，
      // 若不加前缀会把「启用渠道」覆盖成「独立视觉」「天气主机」之类。
      if (!path.startsWith('adapters.')) continue;
      const key = path.split('.').pop();
      if (key && item.label) map[key] = item.label;
    }
  }
  return map;
}

function labelFor(key, labelMap) {
  if (labelMap[key]) return labelMap[key];
  if (ONEBOT_LABELS[key]) return ONEBOT_LABELS[key];
  if (TELEGRAM_LABELS[key]) return TELEGRAM_LABELS[key];
  return key.replace(/_/g, ' ');
}

function defaultsFor(def) {
  const result = {};
  for (const [key, spec] of Object.entries(def.properties || {})) {
    if (key === 'type' || key === 'mode' || key === 'whitelist' || key === 'blacklist') {
      continue;
    }
    if (spec.default !== undefined) {
      result[key] = clone(spec.default);
    } else if (spec.type === 'array') {
      result[key] = [];
    } else if (spec.type === 'boolean') {
      result[key] = false;
    } else if (spec.type === 'integer' || spec.type === 'number') {
      result[key] = 0;
    } else {
      result[key] = '';
    }
  }
  return result;
}

function valuesFor(def, current, sameType) {
  const defaults = defaultsFor(def);
  if (!sameType || !current) return defaults;
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (current[key] !== undefined) result[key] = clone(current[key]);
  }
  return result;
}

function protocolGroups(protocol) {
  return protocol.id === 'telegram' ? FIELD_GROUPS.telegram : FIELD_GROUPS.onebot;
}

function arrayText(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

function parseArrayText(raw) {
  return String(raw)
    .replace(/[，、;；]+/g, '\n')
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 渲染渠道与协议面板。
 *
 * @param {HTMLElement} container 设置页当前分页容器
 * @param {object} ctx 设置页上下文（toast / navigate / …）
 * @param {object} options
 *   - protocolData: /api/adapters/protocols 响应
 *   - configData:   /api/adapters/config 响应（Runtime 未就绪时为 null）
 *   - groups:       /api/settings 的 groups（用于复用中文标签）
 *   - markRestart:  需要重启时通知设置页顶部提示条
 */
export async function renderAdapterPanel(container, ctx, options = {}) {
  const protocolData = options.protocolData || {};
  const protocols = protocolData.protocols || [];
  const schemaDefs = protocolData.config_schema?.$defs || {};
  const labelMap = buildLabelMap(options.groups);
  const secretsIndex = Array.isArray(options.secretsIndex)
    ? options.secretsIndex : [];
  const markRestart = typeof options.markRestart === 'function'
    ? options.markRestart : () => {};

  const adapters = options.configData?.adapters || {};
  // 当前是单主适配器；优先使用约定键 default，没有时再退回第一个。
  const adapterName = Object.prototype.hasOwnProperty.call(adapters, 'default')
    ? 'default' : Object.keys(adapters)[0] || 'default';
  let current = adapters[adapterName] || null;
  let preserved = {
    whitelist: clone(current?.whitelist) || undefined,
    blacklist: clone(current?.blacklist) || undefined,
  };
  let selectedType = current?.type || protocols.find((p) => p.status !== 'planned')?.id || 'napcat';
  let draft = null;
  let baselineDraft = {};
  let baselineType = '';
  let dirty = false;
  let saving = false;
  let dirtyBadge = null;
  let saveBtn = null;
  const formHost = h('div', {});

  function selectedProtocol() {
    return protocols.find((item) => item.id === selectedType) || null;
  }

  function schemaDefFor(protocol) {
    if (!protocol) return null;
    return schemaDefs[protocol.config_model] || null;
  }

  function resetDraft() {
    const protocol = selectedProtocol();
    const def = schemaDefFor(protocol);
    draft = def
      ? valuesFor(def, current, current?.type === selectedType)
      : {};
  }

  function computeDirty() {
    if (!current) return false;
    return selectedType !== baselineType
      || JSON.stringify(draft) !== JSON.stringify(baselineDraft);
  }

  function notifyDirty() {
    if (saving) return;
    const next = computeDirty();
    const changed = next !== dirty;
    dirty = next;
    formHost.dataset.dirty = dirty ? '1' : '0';
    if (dirtyBadge) dirtyBadge.style.display = dirty ? '' : 'none';
    if (saveBtn) saveBtn.disabled = !dirty;
    if (changed && typeof options.onDirtyChange === 'function') {
      options.onDirtyChange(dirty);
    }
  }

  // 保存成功/重新读取后，以当前服务端配置作为新的「未保存」基线。
  function refreshBaseline() {
    const protocol = protocols.find((item) => item.id === current?.type) || null;
    const def = protocol ? schemaDefFor(protocol) : null;
    baselineType = current?.type || '';
    baselineDraft = def ? valuesFor(def, current, true) : {};
    dirty = false;
    notifyDirty();
  }

  resetDraft();
  refreshBaseline();
  formHost.addEventListener('input', () => notifyDirty());
  formHost.addEventListener('change', () => notifyDirty());

  // ---- 状态卡片 ---------------------------------------------------------

  const statusHost = h('div', {});

  function renderStatus(data) {
    const adapter = data?.adapter;
    const config = data?.config?.[adapterName] || null;
    if (!adapter) {
      fill(statusHost, card('运行状态', '当前没有运行中的渠道（可能全部未启用）。',
        empty('没有运行中的适配器', {
          subtitle: '保存并启用一个渠道后，这里会显示连接状态与能力表。',
          iconName: 'plug',
        })));
      return;
    }
    const caps = adapter.capabilities || {};
    const capTags = Object.keys(CAPABILITY_LABELS).map((key) =>
      h('span', {
        class: `capability-tag ${caps[key] ? 'on' : 'off'}`,
        title: caps[key] ? '当前协议支持' : '当前协议不支持',
      }, CAPABILITY_LABELS[key]));
    const endpoint = config
      ? adapterEndpoint({ ...config }, config)
      : '';
    const typeName = adapterTypeLabel(config?.type) || adapter.name;
    const dialectName = adapter.dialect_display_name
      || adapterDialectLabel(adapter.dialect);
    const source = adapter.class ? `${adapter.name} · ${adapter.class}` : adapter.name;
    fill(statusHost, card('运行状态', '能力表由当前适配器上报，前端按能力显隐按钮，不按协议类型硬编码。',
      h('div', { class: 'row row-wrap', style: { marginBottom: endpoint ? '6px' : '12px' } },
        h('span', { class: `badge ${adapter.connected ? 'ok' : 'idle'}` },
          adapter.connected ? '已连接' : '未连接'),
        h('span', { class: 'field-help' },
          [
            typeName,
            adapterTransportLabel(config?.transport),
            dialectName && dialectName !== typeName ? dialectName : '',
          ].filter(Boolean).join(' · ')),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'btn btn-sm',
          onclick: () => refreshStatus(),
        }, '刷新状态'),
      ),
      endpoint ? h('div', { class: 'field-help', style: { marginBottom: '4px' } }, endpoint) : null,
      h('div', { class: 'field-help', style: { marginBottom: '12px' } }, source),
      h('div', { class: 'capability-grid' }, ...capTags),
    ));
  }

  async function refreshStatus() {
    fill(statusHost, card('运行状态', '', empty('正在读取运行状态…')));
    try {
      renderStatus(await endpoints.adapterStatus());
    } catch (e) {
      fill(statusHost, card('运行状态', '', empty(`运行状态暂不可用：${e.message}`, {
        subtitle: 'Runtime 未就绪时属正常现象；保存配置后会自动刷新。',
        iconName: 'plug',
      })));
    }
  }

  // ---- 协议卡片 ---------------------------------------------------------

  const cardsHost = h('div', { class: 'protocol-grid' });

  async function showProtocolDocs(protocol) {
    if (!protocol?.id) return;

    const body = h('div', {}, empty('正在读取协议介绍…'));
    const view = modal({
      title: `${protocol.name || '协议'}介绍`,
      subtitle: protocol.docs || '协议接入说明',
      body,
      wide: true,
      footer: h('button', {
        class: 'btn',
        onclick: () => view.close(),
      }, '关闭'),
    });
    document.body.append(view.el);

    try {
      const result = await endpoints.adapterDocs(protocol.id);
      const content = typeof result?.content === 'string'
        ? result.content : (typeof result?.markdown === 'string' ? result.markdown : '');
      fill(body, content
        ? h('pre', { class: 'protocol-doc-content' }, content)
        : empty('协议介绍暂为空'));
    } catch (e) {
      fill(body, empty(`无法读取协议介绍：${e.message}`, {
        subtitle: '请稍后重试，或查看服务端 docs/protocols 目录。',
      }));
    }
  }

  function renderProtocolCards() {
    fill(cardsHost, ...protocols.map((protocol) => {
      const meta = PROTOCOL_STATUS[protocol.status] || { label: protocol.status, cls: 'idle' };
      const planned = protocol.status === 'planned';
      const active = protocol.id === selectedType;
      return h('div', {
        class: `protocol-card ${active ? 'active' : ''} ${planned ? 'planned' : ''}`,
        title: protocol.docs ? `文档：${protocol.docs}` : protocol.name,
      },
        h('div', { class: 'protocol-card-head' },
          h('span', { class: 'protocol-card-name' }, protocol.name),
          h('span', { class: `badge ${meta.cls}` }, meta.label)),
        h('p', { class: 'protocol-card-summary' }, protocol.summary || ''),
        h('div', { class: 'protocol-card-meta' },
          ...(protocol.transports || []).map((item) =>
            h('span', { class: 'protocol-tag' }, optionLabel('transport', item))),
          ...(protocol.dialects || []).slice(0, 3).map((item) =>
            h('span', { class: 'protocol-tag' }, item))),
        h('div', { class: 'protocol-card-actions' },
          h('button', {
            type: 'button',
            class: 'btn btn-sm',
            disabled: active || planned,
            onclick: () => selectProtocol(protocol),
          }, planned ? '尚未支持' : active ? '已选择' : '选择'),
          h('button', {
            type: 'button',
            class: 'btn btn-sm',
            onclick: () => showProtocolDocs(protocol),
          }, '查看介绍')),
      );
    }));
  }

  function selectProtocol(protocol) {
    if (!protocol || protocol.status === 'planned') {
      if (protocol) ctx.toast(`${protocol.name} 尚未支持`, 'warn');
      return;
    }
    if (protocol.id === selectedType) return;
    if (current?.type && protocol.id !== current.type) {
      const ok = confirm(
        `当前渠道类型是 ${current.type}。\n`
        + `切换为 ${protocol.name} 会整份替换适配器配置并断开现有连接，确定继续？`,
      );
      if (!ok) return;
    }
    selectedType = protocol.id;
    resetDraft();
    notifyDirty();
    renderProtocolCards();
    renderForm();
  }

  // ---- 动态表单 ---------------------------------------------------------

  function controlFor(key, spec, value) {
    const kind = schemaType(spec);
    const help = trimHelp(spec.description);
    const label = labelFor(key, labelMap);

    if (isSecretField(key)) {
      const listId = `secret-ref-${key}`;
      const idInput = h('input', {
        value: value || '',
        placeholder: '密钥引用 ID，例如 telegram_main_token',
        spellcheck: 'false',
        list: listId,
      });
      idInput.addEventListener('input', () => {
        draft[key] = idInput.value.trim() || null;
      });
      const datalist = h('datalist', { id: listId },
        ...secretsIndex.map((item) => h('option', { value: item })));
      const valueInput = h('input', {
        type: 'password',
        placeholder: '输入要保存的密钥值（不会回显）',
        autocomplete: 'new-password',
        spellcheck: 'false',
      });
      const saveBtn = h('button', { class: 'btn' }, '保存密钥');
      saveBtn.addEventListener('click', async () => {
        const keyId = idInput.value.trim();
        if (!keyId) {
          ctx.toast('请先填写密钥引用 ID', 'error');
          return;
        }
        if (!valueInput.value) {
          ctx.toast('请输入要保存的密钥值', 'error');
          return;
        }
        saveBtn.disabled = true;
        try {
          const result = await endpoints.putSecret(keyId, valueInput.value);
          valueInput.value = '';
          if (!secretsIndex.includes(keyId)) {
            secretsIndex.push(keyId);
            secretsIndex.sort();
            // 同一表单里的其它密钥字段也应立刻能选到新 ID。
            for (const list of document.querySelectorAll('datalist[id^="secret-ref-"]')) {
              if (![...list.options].some((item) => item.value === keyId)) {
                list.append(h('option', { value: keyId }));
              }
            }
          }
          ctx.toast(
            `${result.message || '密钥已保存'}；如引用 ID 有变化，请点击「保存渠道配置」。`,
            'ok',
          );
          if (result.needs_restart) markRestart();
        } catch (e) {
          ctx.toast(e.message, 'error');
        } finally {
          saveBtn.disabled = false;
        }
      });
      return fieldBlock(label,
        h('div', {},
          h('div', { class: 'row' }, idInput),
          h('div', { class: 'row', style: { marginTop: '6px' } }, valueInput, saveBtn),
          datalist,
        ),
        (help || '只保存密钥引用 ID；密钥本身写入加密的 secrets.enc。') + ' 先保存密钥，再保存下方配置。');
    }

    if (kind === 'boolean') {
      const input = h('input', { type: 'checkbox', checked: !!value });
      const stateText = h('span', {}, value ? '已启用' : '已关闭');
      input.addEventListener('change', () => {
        draft[key] = input.checked;
        stateText.textContent = input.checked ? '已启用' : '已关闭';
      });
      return fieldBlock(label, h('label', { class: 'switch' }, input, stateText), help);
    }

    if (kind === 'enum') {
      const select = h('select', {});
      for (const item of spec.enum || []) {
        select.append(h('option', { value: item, selected: item === value },
          optionLabel(key, item)));
      }
      select.addEventListener('change', () => { draft[key] = select.value; });
      return fieldBlock(label, select, help);
    }

    if (kind === 'array') {
      const placeholder = key === 'allowed_updates'
        ? '例如 message, edited_message'
        : '逗号或换行分隔';
      const area = h('textarea', {
        rows: 3,
        placeholder,
        value: arrayText(value),
      });
      area.addEventListener('input', () => { draft[key] = parseArrayText(area.value); });
      return fieldBlock(label, area, `${help || ''}（逗号或换行分隔）`);
    }

    if (kind === 'integer' || kind === 'number') {
      const input = h('input', {
        type: 'number',
        value: value === null || value === undefined ? '' : value,
        step: kind === 'number' ? 'any' : 1,
        min: spec.minimum,
        max: spec.maximum,
      });
      input.addEventListener('input', () => {
        const raw = input.value.trim();
        if (raw === '') return;
        const num = Number(raw);
        if (Number.isFinite(num)) draft[key] = kind === 'integer' ? Math.trunc(num) : num;
      });
      return fieldBlock(label, input, help);
    }

    const input = h('input', {
      value: value === null || value === undefined ? '' : value,
      spellcheck: 'false',
    });
    input.addEventListener('input', () => { draft[key] = input.value; });
    return fieldBlock(label, input, help);
  }

  function renderForm() {
    dirtyBadge = null;
    saveBtn = null;
    const protocol = selectedProtocol();
    const def = schemaDefFor(protocol);

    if (!protocol || !def) {
      fill(formHost, card('协议配置', '', empty('这个协议还没有可用的配置 Schema。')));
      return;
    }

    if (!current) {
      fill(formHost, card('协议配置', '',
        empty(options.configData
          ? '配置里没有任何适配器，无法保存。'
          : '读取完整配置失败：Runtime 可能尚未就绪。',
        {
          subtitle: options.configData
            ? '请检查 config.yaml 的 adapters 段。'
            : 'Runtime 就绪后点下方按钮重试。',
          iconName: 'settings',
        }),
        h('div', { class: 'row' },
          h('button', {
            class: 'btn btn-primary',
            onclick: () => loadConfig(true),
          }, '重试读取渠道配置')),
      ));
      return;
    }

    const properties = def.properties || {};
    const skip = new Set(['type', 'mode', 'whitelist', 'blacklist']);
    const groups = protocolGroups(protocol);

    const coreNodes = [];
    for (const key of groups.core) {
      if (!properties[key] || skip.has(key) || draft[key] === undefined) continue;
      coreNodes.push(controlFor(key, properties[key], draft[key]));
    }

    const advancedNodes = [];
    for (const key of groups.advanced) {
      if (!properties[key] || skip.has(key) || draft[key] === undefined) continue;
      advancedNodes.push(controlFor(key, properties[key], draft[key]));
    }

    // 与 GUI 一致：核心字段直接展示，Webhook/进程/重连等收进默认折叠的
    // 「高级与 Webhook 设置」。未列出的 schema 字段保持当前值，不渲染。
    const needsWebhook = draft.transport === 'http' || draft.transport === 'webhook';
    const sections = [
      h('div', {},
        h('h3', { class: 'form-section-title' }, '连接配置'),
        h('div', { class: 'grid grid-2' }, ...coreNodes),
        needsWebhook ? h('p', { class: 'field-help' },
          '当前接入方式依赖 Webhook；监听地址、端口、路径与密钥在下方'
          + '「高级与 Webhook 设置」中。') : null,
      ),
    ];

    if (advancedNodes.length) {
      sections.push(h('details', { class: 'advanced-settings' },
        h('summary', {}, '高级与 Webhook 设置'),
        h('p', { class: 'field-help' },
          '普通部署保持默认即可；只有跨设备 Webhook、代理、协议端托管或'
          + '自定义重连参数才需要修改。未展示的参数会保留当前值。'),
        h('div', { class: 'grid grid-2', style: { marginTop: '8px' } },
          ...advancedNodes),
      ));
    }

    dirtyBadge = h('span', {
      class: 'badge warn',
      dataset: { dirtyBadge: '1' },
      style: { display: dirty ? '' : 'none' },
    }, '未保存');
    saveBtn = h('button', {
      class: 'btn btn-primary',
      disabled: !dirty,
      onclick: save,
    }, `保存 ${protocol.name} 配置`);
    const reloadBtn = h('button', {
      class: 'btn',
      onclick: () => {
        if (dirty
            && !confirm('有未保存的修改，重新读取会丢弃这些修改。确定继续？')) {
          return;
        }
        loadConfig(true);
      },
    }, '重新读取');

    fill(formHost, card('协议配置', protocol.summary || '',
      ...sections,
      h('div', { class: 'row row-wrap', style: { marginTop: '8px' } },
        dirtyBadge,
        saveBtn,
        reloadBtn,
        h('div', { class: 'spacer' }),
        h('span', { class: 'field-help' },
          '保存会整份替换该适配器配置并触发后端热重载。黑白名单请到左侧「黑白名单」页管理。')),
    ));
    notifyDirty();
  }

  function validateDraft(def) {
    for (const [key, spec] of Object.entries(def.properties || {})) {
      const kind = schemaType(spec);
      if (kind !== 'integer' && kind !== 'number') continue;
      const value = draft[key];
      if (value === undefined || value === null || value === '') continue;
      if (!Number.isFinite(Number(value))) {
        return `${labelFor(key, labelMap)} 需要数字`;
      }
    }
    return '';
  }

  async function save() {
    if (!current || saving) return;
    const protocol = selectedProtocol();
    if (!protocol) return;
    if (!dirty) return;
    if (protocol.status === 'planned') {
      ctx.toast(`${protocol.name} 尚未支持`, 'warn');
      return;
    }
    const def = schemaDefFor(protocol);
    const invalid = def ? validateDraft(def) : '';
    if (invalid) {
      ctx.toast(invalid, 'error');
      return;
    }

    const payload = {
      ...clone(draft),
      type: selectedType,
    };
    delete payload.mode;
    if (preserved.whitelist) payload.whitelist = clone(preserved.whitelist);
    if (preserved.blacklist) payload.blacklist = clone(preserved.blacklist);
    for (const key of Object.keys(payload)) {
      if (isSecretField(key) && !payload[key]) payload[key] = null;
    }

    saving = true;
    const buttons = formHost.querySelectorAll('button');
    for (const btn of buttons) btn.disabled = true;
    try {
      const result = await endpoints.saveAdapter(adapterName, payload);
      current = result.adapter || current;
      preserved = {
        whitelist: clone(current?.whitelist) || preserved.whitelist,
        blacklist: clone(current?.blacklist) || preserved.blacklist,
      };
      if (result.needs_restart) {
        markRestart();
        ctx.toast(result.message || '配置已保存；需要重启 Runtime 才生效', 'warn');
      } else {
        ctx.toast(result.message || '渠道配置已保存并热重载', 'ok');
      }
      const errors = result.reload?.errors || [];
      for (const message of errors) {
        ctx.toast(`热重载错误：${message}`, 'error');
      }
      saving = false;
      resetDraft();
      refreshBaseline();
      renderForm();
      refreshStatus();
    } catch (e) {
      saving = false;
      ctx.toast(`保存失败：${e.message}`, 'error');
      for (const btn of formHost.querySelectorAll('button')) btn.disabled = false;
      notifyDirty();
    }
  }

  async function loadConfig(force = false) {
    if (force) {
      dirty = false;
      saving = false;
      if (typeof options.onDirtyChange === 'function') options.onDirtyChange(false);
      fill(formHost, card('协议配置', '', empty('正在读取适配器配置…')));
      try {
        const data = await endpoints.adapterConfig();
        options.configData = data;
        const nextAdapters = data.adapters || {};
        const nextName = Object.prototype.hasOwnProperty.call(nextAdapters, 'default')
          ? 'default' : Object.keys(nextAdapters)[0] || adapterName;
        current = nextAdapters[nextName] || null;
        preserved = {
          whitelist: clone(current?.whitelist),
          blacklist: clone(current?.blacklist),
        };
        resetDraft();
        refreshBaseline();
        renderProtocolCards();
        renderForm();
        refreshStatus();
      } catch (e) {
        formHost.dataset.dirty = '0';
        fill(formHost, card('协议配置', '', empty(`重新读取失败：${e.message}`)));
      }
    }
  }

  // ---- 组装 -------------------------------------------------------------

  fill(container,
    statusHost,
    card('协议', '从左侧或下方选择接入协议；卡片与字段都来自后端协议目录，新增协议无需改前端。',
      cardsHost),
    formHost,
  );

  renderProtocolCards();
  renderForm();
  await refreshStatus();

  return {
    destroy() {},
  };
}
