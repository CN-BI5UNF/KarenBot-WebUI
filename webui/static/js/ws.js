// 与 /ws/events 的连接，带自动重连。
// 一条连接同时收三类事件：log（日志行）、chat（QQ 消息）、status（运行状态）。

const MAX_BACKOFF = 15000;
// 后端在鉴权失败时使用 4401 关闭码。此时重连只会被反复拒绝，
// 应交给登录界面处理，而不是无限退避。
const UNAUTHORIZED_CLOSE_CODE = 4401;

export class EventStream {
  constructor() {
    this.socket = null;
    this.handlers = new Set();
    this.backoff = 1000;
    this.closedByUser = false;
    this.connected = false;
    this._reconnectTimer = null;
    this.onConnectionChange = () => {};
    this.onUnauthorized = () => {};
  }

  connect() {
    this.closedByUser = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${scheme}://${location.host}/ws/events`;

    const previous = this.socket;
    this.socket = null;
    if (this.connected) this.onConnectionChange(false);
    this.connected = false;
    if (previous) {
      previous.onopen = null;
      previous.onmessage = null;
      previous.onclose = null;
      previous.onerror = null;
      previous.close();
    }

    let socket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.connected = true;
      this.backoff = 1000;
      this.onConnectionChange(true);
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      for (const handler of this.handlers) {
        try {
          handler(payload);
        } catch (e) {
          console.error('事件处理失败', e);
        }
      }
    };

    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connected = false;
      this.onConnectionChange(false);
      if (event.code === UNAUTHORIZED_CLOSE_CODE) {
        this.closedByUser = true;
        this.onUnauthorized();
        return;
      }
      if (!this.closedByUser) this._scheduleReconnect();
    };

    socket.onerror = () => {
      if (this.socket !== socket) return;
      // onclose 紧随其后，重连逻辑统一放在那里。
      socket.close();
    };
  }

  _scheduleReconnect() {
    // 只保留一个待重连定时器；close() 后立刻 connect() 不应产生并发连接。
    if (this._reconnectTimer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 1.7, MAX_BACKOFF);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this.closedByUser) this.connect();
    }, delay);
  }

  subscribe(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close() {
    this.closedByUser = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    if (this.connected) this.onConnectionChange(false);
    this.connected = false;
  }
}
