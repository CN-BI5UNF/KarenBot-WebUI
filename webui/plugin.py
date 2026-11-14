"""WebUI 前端插件入口。

WebUI 仍然由自己的 uvicorn 启动器托管 RuntimeHost；插件层只负责把统一入口
的 host/port/token/config 传过去。
"""

from __future__ import annotations

from backend.plugin_host import FrontendPlugin, PluginContext


class WebUIFrontendPlugin(FrontendPlugin):
    def run(self, context: PluginContext) -> int:
        from .server import run_webui

        run_webui(
            context.project_root,
            host=context.host,
            port=context.port,
            config_file=context.config_file,
            token=context.token,
            no_auth=context.no_auth,
        )
        return 0


__all__ = ["WebUIFrontendPlugin"]
