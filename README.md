# KarenBot-WebUI

KarenBot 的**浏览器前端**模块。仓库已公开，当前版本 **v2.1.3-alpha**（KarenBot 统一发行版）。

> 这是模块源码仓库，不是独立应用。运行前需要 KarenBot 宿主和兼容的
> `KarenBot-backend`（v2.1.3-alpha）。

## 这是什么

`webui/` 只负责浏览器界面和薄服务器入口：

- `webui/server.py`：挂载静态资源、生成令牌横幅、预检端口、启动 uvicorn
- `webui/static/`：HTML、CSS、原生 ES Module JavaScript
- `webui/theme.py`：前端色板常量
- `webui/__init__.py`：前端版本
- `webui/plugin.json` + `webui/plugin.py`：前端插件清单与统一入口

更新页优先显示 KarenBot 统一发行版，同时更新后端与当前前端。

后端控制面位于独立的 `backend/` 包，通过 `backend.app.create_control_app()` 提供全部
API、鉴权、Runtime 生命周期和事件流。这样 WebUI 与原生 GUI 共用同一份后端能力。

## 兼容性

| 项目 | 版本 |
|---|---|
| 本模块 release | `v2.1.3-alpha`（统一发行版） |
| 配套后端 | `v2.1.3-alpha` |
| 配套 GUI | `v2.1.3-alpha` |
| 过渡版 | 前端 `v0.1.1-alpha.2` / 后端 `v0.1.11-alpha.1` |

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
uv run python main.py            # 默认 127.0.0.1:8000，仅本机
uv run python webui_server.py    # 等价入口
```

默认只监听本机回环地址。需要局域网内其它设备访问时，任选一种方式：

1. 在 WebUI 的 **设置 → 网络** 打开“允许暴露在局域网中”，保存后重启 WebUI 服务；
2. 在 `config.yaml` 设置 `webui.allow_lan: true`；
3. 启动时显式指定监听地址（会覆盖配置）：

```bash
python main.py --host 0.0.0.0 --port 8000
python webui_server.py --host 0.0.0.0 --port 8000
```

其它常用参数：

```bash
python webui_server.py --port 8000
python webui_server.py --token 'your-token'
python webui_server.py --no-auth # 仅限本机/可信网络
```

首次启动会生成访问令牌，并保存到数据目录的 `webui_token.txt`（权限 0600）。

## 页面

侧栏页面包括：总览、对话、记忆、人格后台、日志、人格、黑话、知识、模型管理、表情包、
容器、存储与数据、黑白名单、群聊触发、设置。页面行为、按钮和设置字段由 `backend/`
的 API 与前端静态模块共同提供。

首次配置默认暂不连接 QQ。准备好 NapCat 后可在向导打开“连接 QQ”，或在完成后到
**设置 → 渠道与协议**启用。汇总页可返回修改各步骤，并提示子 Agent 的额外模型调用。

普通设置修改后自动保存：开关和选项立即提交，文本移开焦点或按 Enter 提交，多行文本
支持 Ctrl+Enter。带“保存”按钮的面板需点击保存。通用字段显示保存结果，失败时恢复
上次保存的值；需要重启 Runtime 或 WebUI 服务的变更会显示对应提示。

### 备份与恢复

在 **设置 → 备份** 中可以分别选择配置、凭据、聊天记录、RAG、工作区、表情包、
自定义提供商和人格数据；工作区中的入站媒体与附件可单独选择。开始前会显示各类
数据及总大小，执行期间展示逐类预计量与实际处理量。

已有备份可先验证，再勾选需要恢复的类别。预览会列出备份和当前数据大小、将覆盖的
文件数量及警告；确认后服务会先自动创建当前数据的回滚备份，再应用所选内容。仅备份
中存在的文件会被添加或覆盖，备份未包含的其它目标文件会保留。凭据备份包含加密密钥
库和 RSA 密钥材料，备份文件应按敏感凭据保护。

## 开发验证

行为回归使用 Node.js 22，无需安装 npm 依赖：

```bash
node --test tests/ui-behavior.test.mjs
```

测试直接导入页面模块，用轻量 DOM 替身覆盖向导重试、名单处理、设置回滚和异步按钮。
真实浏览器的排版与交互仍需另行验证。

## 安全边界

- 本仓库只包含前端源码，不包含配置、密钥、聊天记录、日志或数据目录。
- WebUI 默认只监听 `127.0.0.1`，且默认需要令牌；开启 `webui.allow_lan` 或传入
  `--host 0.0.0.0` 后，同一网络内的设备才能访问，仍然需要令牌。
- `--no-auth` 会让能访问端口的人读取记录和修改配置，只在可信环境使用。
- 不要把 `webui_token.txt`、`.env` 或代理凭据提交到仓库；`.gitignore` 已覆盖常见敏感文件。

## 版本与发布

- 版本标签格式：`vMAJOR.MINOR.PATCH[-dev]`
- 当前统一发行版为 `v2.1.3-alpha`；该标签作为正式发行版发布，不标记为 Pre-release。
- Release 自动提供源码归档，并附带模块源码 zip。
- 与后端模块的兼容关系见上表；后端不兼容升级时前端需要对应升级。

## 许可证与来源

沿用 KarenBot 的 **Apache-2.0** 许可证，并保留上游 Debata_Agent 的版权声明，
详见 `LICENSE` 与 `NOTICE`。

相关仓库：

- [KarenBot-backend](https://github.com/CN-BI5UNF/KarenBot-backend)
- [KarenBot-GUI](https://github.com/CN-BI5UNF/KarenBot-GUI)
