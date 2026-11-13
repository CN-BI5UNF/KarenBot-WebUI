"""WebUI 前端服务与启动入口。

后端控制面已经移到 ``backend/``；本模块只负责：

* 用 ``backend.app.create_control_app`` 装配共享 API；
* 挂载 ``webui/static`` 的浏览器前端资源；
* 提供 WebUI 的访问令牌横幅、端口预检和 uvicorn 启动。

原生 GUI 不导入本模块，也不需要 `webui/static`；两个前端只共享
``backend``，因此后端功能不会出现“WebUI 有、GUI 没有”的分叉。
"""

from __future__ import annotations

import logging
import os
import socket
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.app import create_control_app
from backend.auth import (
    TokenAuth,
    format_token_banner,
    lan_urls,
    load_or_create_token,
)
from backend.runtime_host import RuntimeHost
from utils.proxy_env import sanitize_no_proxy_env

from . import __version__

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent / "static"

# 不需要鉴权的路径前缀（登录页本身 + 前端静态资源 + OpenAPI 文档）。
PUBLIC_PREFIXES = ("/api/auth/", "/static/", "/favicon.ico", "/docs", "/openapi.json")


def create_app(host: RuntimeHost, auth: TokenAuth) -> FastAPI:
    """构造供浏览器使用的应用：共享后端控制面 + WebUI 静态前端。"""
    app = create_control_app(
        host,
        auth,
        title="KarenBot WebUI",
        description="KarenBot 的浏览器控制台；后端控制面由 backend 提供。",
        version=__version__,
        public_prefixes=PUBLIC_PREFIXES,
        docs=True,
        frontend="webui",
    )
    _install_static_cache_headers(app)
    _install_routes(app)
    return app


def _install_static_cache_headers(app: FastAPI) -> None:
    """静态前端没有构建哈希，必须让浏览器每次重新验证。

    Starlette 的 StaticFiles 只发 ETag/Last-Modified，不发 Cache-Control；
    浏览器可能用启发式缓存长期保留旧 app.css。用户升级 WebUI 后就会遇到
    “类名切了但样式没变”的假故障（例如更新日志无法收起）。no-cache 仍然
    允许 304 复用，不会重复下载未变化的文件。
    """

    @app.middleware("http")
    async def static_cache(request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        path = request.url.path
        if path == "/" or path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response


def _install_routes(app: FastAPI) -> None:
    @app.get("/", include_in_schema=False)
    async def index() -> Any:
        index_file = STATIC_DIR / "index.html"
        if not index_file.is_file():
            return JSONResponse(status_code=500, content={"detail": "前端资源缺失"})
        return FileResponse(index_file, media_type="text/html; charset=utf-8")

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon() -> Any:
        icon = STATIC_DIR / "favicon.svg"
        if icon.is_file():
            return FileResponse(icon, media_type="image/svg+xml")
        return JSONResponse(status_code=404, content={})

    if STATIC_DIR.is_dir():
        app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ============================================================
# 启动入口
# ============================================================


def _port_available(host: str, port: int) -> bool:
    """检查端口是否还能绑定。

    在构造 Runtime 之前先检查，避免端口被占用时先加载配置/拉起 Runtime，
    最后才由 uvicorn 抛出一大段 Errno 98 栈——那看起来像“启动崩溃”。
    """
    try:
        infos = socket.getaddrinfo(
            host or "0.0.0.0",
            port,
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror:
        return True
    for family, socktype, proto, _, sockaddr in infos:
        sock = socket.socket(family, socktype, proto)
        try:
            if os.name != "nt":
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(sockaddr)
        except OSError:
            return False
        finally:
            sock.close()
    return True


def run_webui(
    project_root: Path,
    *,
    host: str = "0.0.0.0",
    port: int = 8000,
    config_file: Path | None = None,
    token: str | None = None,
    no_auth: bool = False,
    log_level: str = "info",
) -> None:
    """启动 WebUI（阻塞直到 Ctrl+C）。"""
    import uvicorn

    if not _port_available(host, port):
        print(
            f"\n端口 {port} 已被占用，Karen 可能已经在运行。\n"
            f"  查看状态: karen status\n"
            f"  查看日志: karen log\n"
            f"  换端口启动: python main.py --host {host} --port 9000\n",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(1)

    runtime_host = RuntimeHost(project_root=project_root, config_file=config_file)
    paths = runtime_host.build_paths()
    _ensure_logging(project_root, paths)

    # 在加载 Runtime 前记录本进程实际看到的源码身份。之后即使磁盘上的
    # 静态资源/源码被更新，这个快照也不会冒充成“已加载版本”。
    from core.build_identity import capture_build_identity

    capture_build_identity(project_root)

    # 必须早于任何 httpx 客户端构造（客户端要等 lifespan 里 host.start() 才建）：
    # NO_PROXY 里的 [::1] 会让 AsyncOpenAI 一构造就抛 InvalidURL，provider 建不出来，
    # Runtime 就停在启动失败。放在 _ensure_logging 之后，清理动作才有日志可看。
    sanitize_no_proxy_env()

    if no_auth:
        auth = TokenAuth(None, enabled=False, source="--no-auth")
    elif token:
        auth = TokenAuth(token, enabled=True, source="--token")
    else:
        value, source = load_or_create_token(paths)
        auth = TokenAuth(value, enabled=True, source=source)

    app = create_app(runtime_host, auth)

    # flush：输出被重定向到文件/容器日志时，stdout 是块缓冲的，
    # 不主动刷就会让「启动横幅 + 令牌」迟迟不出现。
    print(format_token_banner(auth, host=host, port=port, urls=lan_urls(host, port)), flush=True)

    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level=log_level,
        access_log=False,
        ws_ping_interval=25.0,
        ws_ping_timeout=25.0,
        # 不设置时 uvicorn 会无限等待 WebSocket 客户端自行断开，
        # NapCat / 浏览器保持连接时 `karen stop` 会被 systemd 超时强杀。
        timeout_graceful_shutdown=10,
    )
    server = uvicorn.Server(config)
    app.state.server = server

    try:
        server.run()
    except KeyboardInterrupt:
        print("\n收到 Ctrl+C，已退出。")


def _ensure_logging(project_root: Path, paths: Any) -> None:
    """确保 root logger 已配置。

    ``main.py`` 启动时会自己配好 logging，但 ``webui_server.py`` /
    ``python -m webui.server`` 是直接进来的，不配的话 Runtime 的报错
    只会落到 ``logging.lastResort``，用户看不到栈。
    """
    if logging.getLogger().handlers:
        return
    try:
        from main import setup_logging

        setup_logging("INFO", project_root=project_root, logs_dir=paths.LOGS_DIR)
    except Exception:  # noqa: BLE001
        logging.basicConfig(level=logging.INFO)


def main(argv: list[str] | None = None) -> int:
    """``python -m webui.server`` 的入口（也供根目录脚本复用）。"""
    import argparse

    parser = argparse.ArgumentParser(
        prog="karen-webui", description="KarenBot WebUI 服务"
    )
    parser.add_argument("--host", default="0.0.0.0", help="监听地址（默认 0.0.0.0，局域网可访问）")
    parser.add_argument("--port", type=int, default=8000, help="监听端口（默认 8000）")
    parser.add_argument("--config", default="", help="自定义配置文件路径")
    parser.add_argument("--token", default="", help="访问令牌（默认自动生成并记住）")
    parser.add_argument("--no-auth", action="store_true", help="关闭令牌鉴权（仅限完全可信内网）")
    parser.add_argument("--log-level", default="info", help="uvicorn 日志级别")
    args = parser.parse_args(argv)

    project_root = Path(__file__).resolve().parent.parent
    config_file = Path(args.config) if args.config else None

    run_webui(
        project_root,
        host=args.host,
        port=args.port,
        config_file=config_file,
        token=args.token or None,
        no_auth=args.no_auth,
        log_level=args.log_level,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
