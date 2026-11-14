# KarenBot-WebUI

KarenBot 的**浏览器前端**模块。仓库已公开，当前版本 **v0.1.1-alpha.1**。

> 这是模块源码仓库，不是独立应用。运行前需要 KarenBot 宿主和兼容的
> `KarenBot-backend`（v0.1.1-alpha.1）。

## 这是什么

`webui/` 只负责浏览器界面和薄服务器入口：

- `webui/server.py`：挂载静态资源、生成令牌横幅、预检端口、启动 uvicorn
- `webui/static/`：HTML、CSS、原生 ES Module JavaScript
- `webui/theme.py`：前端色板常量
- `webui/__init__.py`：前端版本
- `webui/plugin.json` + `webui/plugin.py`：前端插件清单与统一入口

更新页已把后端更新与 WebUI 前端更新拆成两个独立区块。

后端控制面位于独立的 `backend/` 包，通过 `backend.app.create_control_app()` 提供全部
API、鉴权、Runtime 生命周期和事件流。这样 WebUI 与原生 GUI 共用同一份后端能力。

## 兼容性

| 项目 | 版本 |
|---|---|
| 本模块 release | `v0.1.1-alpha.1`（预发布） |
| 配套后端 | `KarenBot-backend` `v0.1.1-alpha.1` |
| KarenBot 宿主 | `1.0.1-alpha.1` 拆分版本及后续兼容版本 |
| 配套 GUI | `KarenBot-GUI` `v0.1.1-alpha.1` |

## 目录

```text
webui/
├── server.py           静态挂载 + uvicorn 启动
├── __init__.py         前端版本
├── theme.py            色板常量
└── static/
    ├── index.html
    ├── app.css
    ├── favicon.svg
    └── js/
        ├── app.js      导航与页面生命周期
        ├── api.js      HTTP 客户端
        ├── ws.js       事件 WebSocket
        ├── providers.js
        ├── setup/      首次配置向导
        └── pages/      每个控制台页面
```

前端没有构建步骤，不依赖 React/Vue/打包器；修改后刷新浏览器即可。

## 集成方式

把 `webui/` 放到 KarenBot 宿主项目根目录，并确保宿主已有 `backend/`：

```bash
cp -a /path/to/KarenBot-WebUI/webui ./webui
```

启动方式（使用宿主项目的 `webui_server.py` / `main.py`）：

```bash
uv run python main.py            # 默认 0.0.0.0:8000
uv run python webui_server.py    # 等价入口
```

常用参数：

```bash
python webui_server.py --host 127.0.0.1 --port 8000
python webui_server.py --token 'your-token'
python webui_server.py --no-auth # 仅限本机/可信网络
```

首次启动会生成访问令牌，并保存到数据目录的 `webui_token.txt`（权限 0600）。

## 页面

侧栏页面包括：总览、对话、记忆、人格后台、日志、人格、黑话、知识、模型管理、表情包、
容器、存储与数据、黑白名单、群聊触发、设置。页面行为、按钮和设置字段由 `backend/`
的 API 与前端静态模块共同提供。

## 安全边界

- 本仓库只包含前端源码，不包含配置、密钥、聊天记录、日志或数据目录。
- WebUI 默认需要令牌；`--no-auth` 会让能访问端口的人读取记录和修改配置，只在可信环境使用。
- 不要把 `webui_token.txt`、`.env` 或代理凭据提交到仓库；`.gitignore` 已覆盖常见敏感文件。

## 版本与发布

- 版本标签格式：`vMAJOR.MINOR.PATCH[-dev]`
- 当前 `v0.1.1-alpha.1` 为预发布开发版，页面与 API 可能调整。
- Release 自动提供源码归档，并附带模块源码 zip。
- 与后端模块的兼容关系见上表；后端不兼容升级时前端需要对应升级。

## 许可证与来源

沿用 KarenBot 的 **Apache-2.0** 许可证，并保留上游 Debata_Agent 的版权声明，
详见 `LICENSE` 与 `NOTICE`。

相关仓库：

- [KarenBot-backend](https://github.com/CN-BI5UNF/KarenBot-backend)
- [KarenBot-GUI](https://github.com/CN-BI5UNF/KarenBot-GUI)
