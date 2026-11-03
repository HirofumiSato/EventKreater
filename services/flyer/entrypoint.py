"""Fly.io 上で 6PN（IPv6）とヘルスチェック（IPv4）の両方を受けるための起動口。

uvicorn の ``--host ::`` は、このイメージの環境では **IPv6 専用**のソケットになり、
Fly のヘルスチェック（``127.0.0.1`` への IPv4）が ``connection refused`` になる。
同じコンテナで素の Python が ``::`` に bind すると IPv4 でも 200 を返すため、
ソケットの作り方の差で IPv6 専用になっている（Node は ``IPV6_V6ONLY=0`` を明示するので
web 側は両方で受けられる。Python は明示しない）。

そこでここでソケットを作り、``IPV6_V6ONLY=0`` を立ててから uvicorn に ``--fd`` で渡す。
``--host`` では指定できないため、起動の入口をこのファイルに置いている。

2026-11-03 に Fly.io の実機で確認:
- uvicorn ``--host ::``: IPv6 は 200、IPv4 は refused
- uvicorn ``--host 0.0.0.0``: IPv4 は 200、IPv6（6PN）は拒否
- この起動口: IPv4 と IPv6 の両方が 200
"""

from __future__ import annotations

import os
import socket
import sys

HOST = "::"
PORT = 8000


def main() -> None:
    """dual-stack のソケットを作り、同じ fd を引き継いで uvicorn を起動する。"""
    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    # 0 を立てないと IPv6 専用になり、Fly のヘルスチェック（IPv4）が届かない。
    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    sock.bind((HOST, PORT))

    # exec すると fd は既定で閉じられる（CLOEXEC）。uvicorn に渡すため引き継ぐ。
    os.set_inheritable(sock.fileno(), True)
    os.execvp(
        sys.executable,
        [sys.executable, "-m", "uvicorn", "src.main:app", "--fd", str(sock.fileno())],
    )


if __name__ == "__main__":
    main()
