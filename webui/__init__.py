"""KarenBot WebUI frontend.

This package contains only the browser frontend and its thin server adapter:

* ``server`` — mounts ``static/`` on top of the shared ``backend`` control API;
* ``static`` — HTML/CSS/JavaScript assets;
* ``theme`` — frontend palette constants shared by CSS tests.

The backend control plane lives in the top-level ``backend`` package and is
also consumed by the native ``gui`` package.  Keeping the frontend and backend
packages separate lets a one-click installer install either client without
dragging the other one's runtime along.
"""

from __future__ import annotations

__all__ = ["__version__"]

__version__ = "1.0.1-alpha.1"
