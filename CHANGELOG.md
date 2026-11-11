# Changelog

## v0.0.1-dev — 2026-11-11

首个私有开发版。

- 从 KarenBot 主项目拆出浏览器前端 `webui/`。
- `webui/server.py` 改为基于 `backend.app.create_control_app()` 的薄入口。
- 保留无构建步骤的 HTML/CSS/ES Module 前端。
- 设置/提供商界面适配后端热应用结果。
- 与 `KarenBot-backend`、`KarenBot-GUI` 的 v0.0.1-dev 配套。
