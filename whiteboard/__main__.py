"""Run with: python3 -m whiteboard [--file diagram.json] [--port 8000]"""

import argparse
import threading
import webbrowser
from pathlib import Path

from .server import make_server


def main() -> None:
    parser = argparse.ArgumentParser(prog="whiteboard", description=__doc__)
    parser.add_argument("--file", default="diagram.json", help="diagram file (created on first save)")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser tab")
    args = parser.parse_args()

    server = make_server(Path(args.file), port=args.port)
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"Whiteboard on {url}  (saving to {Path(args.file).resolve()})  Ctrl+C to stop")
    if not args.no_browser:
        threading.Timer(0.3, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


main()
