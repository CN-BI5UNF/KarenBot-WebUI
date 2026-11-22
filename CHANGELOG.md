# Changelog

## v2.0.1-alpha — 2026-11-22

- 「工具 schema 档位」从 设置 → 软件行为 移到 容器 → Agent 模式；选项和说明仍由后端设置声明提供。
- 设置页新增「网络」分组：可开启/关闭“允许暴露在局域网中”，显示当前监听地址、来源和访问 URL；保存后提供“立即重启 WebUI”。
- 默认只监听 `127.0.0.1`；需要局域网访问时使用设置开关、`webui.allow_lan: true` 或显式 `--host 0.0.0.0`。

## v2.0.0-alpha.1 — 2026-11-21

更新页支持分开更新后端与 WebUI 前端。

- 每个统一发行版卡片提供「重新安装全部 / 重新安装后端 / 重新安装WebUI」或「更新到此版本 / 仅更新后端 / 仅更新WebUI」。
- 确认更新时把所选组件传给 `/api/update/check`；只更新一个组件时明确提示另一端保持当前版本。
- 更新结果展示本次实际更新的组件。
- 修正更新概览中「不能只更新其中一个组件」的旧文案。
- 刷新静态资源缓存版本号。

## v2.0.0-alpha — 2026-11-21

首个 KarenBot 统一发行版。WebUI、GUI、后端版本均为 `2.0.0-alpha`；安装/更新入口为 `CN-BI5UNF/KarenBot` 主仓库。

- WebUI 作为 KarenBot 主仓库的 `modules/KarenBot-WebUI` submodule 维护。
- 更新页只读 KarenBot 统一发行版，后端与当前前端一起更新。
- 从 0.1.x 升级必须先安装过渡版 `v0.1.1-alpha.2`；旧 1.0.x 绑定版本不再支持。

## v0.1.1-alpha.2 — 2026-11-21

过渡版本：WebUI 模块 `0.1.1-alpha.2`，应用代码 `1.0.1-alpha.2`。更新页已适配 KarenBot 统一发行版；请更新后端与本前端后，手动选择 `v2.0.0-alpha`。

- 更新页在 `distribution=true` 时显示单一「KarenBot 发行版」列表；任何版本都会同时更新后端与当前前端，旧后端自动回退双组件列表。
- 设置页新增「外部程序」：随 KarenBot 启动多个自定义程序，支持端口探测、自动重启、环境变量/工作目录和「随 KarenBot 关闭」；保存后热应用。
- 外部程序启动失败按 `failure_seq` 去重：首次/重连后弹窗，后续 toast；状态卡展示 PID、托管状态和错误。
- 移除旧 NapCat 专用 `manage_process` 适配器字段。

## v0.1.1-alpha.1 — 2026-11-15

- 与 `KarenBot-backend`、`KarenBot-GUI` 的 v0.1.1-alpha.1 配套。
- WebUI 注册为前端插件：`webui/plugin.json` + `webui/plugin.py`。
- 更新页把“后端更新”和“WebUI 前端更新”拆成独立区块；两个版本列表各自过滤、刷新和应用。
- 聊天页支持 Display 分页、图片附件预览/灯箱、文件下载到访问机/浏览器打开。
- 修复附件原文件被清理后只显示 workspace 路径：显示“原图已清理”卡片；有 QQ 原始 URL 时通过后端代理尝试恢复。
- 同步 API、设置页、总览、人格、知识页等最新修复与韧性改动。

## v0.1.1-alpha — 2026-11-13

首个公开发布版本。

- 与 `KarenBot-backend`、`KarenBot-GUI`、`KarenBot-WebUI` 的 v0.1.1-alpha 配套。
- 后端新增分模块更新器：同时检查 backend 与前端仓库，Latest 自动提示，Pre-release 仅允许手动选择并强制警告。
- 修复设置、聊天、容器、存储与人格页面的多处数据覆盖、竞态和交互问题。
- GUI 与 WebUI 的更新页支持组件化版本、Pre-release 标识和按组件重启提示。

## v0.0.1-dev — 2026-11-11

首个私有开发版。

- 从 KarenBot 主项目拆出浏览器前端 `webui/`。
- `webui/server.py` 改为基于 `backend.app.create_control_app()` 的薄入口。
- 保留无构建步骤的 HTML/CSS/ES Module 前端。
- 设置/提供商界面适配后端热应用结果。
- 与 `KarenBot-backend`、`KarenBot-GUI` 的 v0.0.1-dev 配套。
