"""Run with: python3 -m whiteboard [--file project.json] [--port 8000]"""

import argparse
import threading
import webbrowser
from pathlib import Path

from .server import make_server


def main() -> None:
    parser = argparse.ArgumentParser(prog="whiteboard", description=__doc__)
    parser.add_argument("--file", help="open this project file straight away (created if it doesn't exist) "
                                       "instead of showing the start screen")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser tab")
    args = parser.parse_args()

    try:
        server = make_server(Path(args.file) if args.file else None, port=args.port)
    except OSError as exc:
        parser.exit(1, f"whiteboard: can't use port {args.port} ({exc.strerror or exc}). "
                       f"Is the whiteboard already running? Try another port, e.g. --port {args.port + 1}\n")
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    opened = f"  (project {Path(args.file).resolve()})" if args.file else ""
    print(f"Whiteboard on {url}{opened}  Ctrl+C to stop")
    if not args.no_browser:
        threading.Timer(0.3, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
