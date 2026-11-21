// 渠道状态的纯展示辅助：总览页和设置→渠道面板共用。
//
// 新后端的 /api/status 只返回 type/transport/dialect；
// 地址（WS/Webhook/长轮询）要从 /api/adapters/status 的 config 摘要里取。

const TYPE_LABELS = {
  napcat: 'NapCatQQ',
  onebot11: 'OneBot 11',
  telegram: 'Telegram',
  qq_official: 'QQ 官方 Bot',
  satori: 'Satori',
};

const TRANSPORT_LABELS = {
  ws_client: 'WebSocket 客户端',
  ws_server: 'WebSocket 服务端',
  http: 'HTTP API + Webhook',
  long_polling: '长轮询',
  webhook: 'Webhook 回调',
  gateway: 'Gateway',
  ws: 'WebSocket',
};

const DIALECT_LABELS = {
  auto: '自动识别',
  napcat: 'NapCatQQ',
  llonebot: 'LLOneBot',
  lagrange: 'Lagrange',
  gocqhttp: 'go-cqhttp',
  generic: '通用 OneBot 11',
};

export function adapterTypeLabel(type) {
  return TYPE_LABELS[type] || type || '';
}

export function adapterTransportLabel(transport) {
  return TRANSPORT_LABELS[transport] || transport || '';
}

export function adapterDialectLabel(dialect) {
  return DIALECT_LABELS[dialect] || dialect || '';
}

/** 根据传输方式给出真正可用的监听/连接地址，避免 Telegram/HTTP 显示 WS 地址。 */
export function adapterEndpoint(adapter, config) {
  if (!adapter || !adapter.type) return '';
  const transport = String(adapter.transport || '');

  if (transport === 'ws_client' || transport === 'ws_server') {
    const host = adapter.host || config?.host;
    const port = adapter.port ?? config?.port;
    if (!host) return '';
    const path = adapter.path || config?.path || '';
    return `${transport === 'ws_server' ? '监听 ' : ''}ws://${host}:${port ?? ''}${path}`;
  }

  if (transport === 'http') {
    if (config?.webhook_host) {
      return `Webhook ${config.webhook_host}:${config.webhook_port ?? ''}`
        + `${config.webhook_path || ''}`;
    }
    if (config?.http_api_url) return `HTTP API ${config.http_api_url}`;
    return 'HTTP API + Webhook';
  }

  if (adapter.type === 'telegram') {
    if (transport === 'webhook') {
      return config?.webhook_public_url
        || (config?.webhook_host
          ? `Webhook ${config.webhook_host}:${config.webhook_port ?? ''}`
            + `${config.webhook_path || ''}`
          : 'Webhook');
    }
    return config?.api_base ? `长轮询 · ${config.api_base}` : '长轮询';
  }

  return '';
}
