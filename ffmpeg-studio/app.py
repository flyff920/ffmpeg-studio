# -*- coding: utf-8 -*-
"""
FFmpeg Studio - Flask 后端
职责：接收前端构建好的参数，执行 ffmpeg/ffprobe，实时回传日志。
不做任何对 FFmpeg 原始功能的修改，仅做可视化封装。
"""
import json
import os
import queue
import re
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin
from urllib.request import Request, urlopen

from flask import Flask, jsonify, request, send_from_directory, Response

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# FFMPEG_BIN = r""
# FFPROBE_BIN = r""

FFMPEG_BIN = r"D:\Program Files\ffmpeg-9.0-full_build\bin\ffmpeg.exe"
FFPROBE_BIN = r"D:\Program Files\ffmpeg-9.0-full_build\bin\ffprobe.exe"
if not os.path.exists(FFMPEG_BIN):
    FFMPEG_BIN = "ffmpeg"
if not os.path.exists(FFPROBE_BIN):
    FFPROBE_BIN = "ffprobe"

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")

# 任务表: id -> {proc, queue, done, code}
TASKS = {}
TASKS_LOCK = threading.Lock()


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/version")
def api_version():
    try:
        out = subprocess.run([FFMPEG_BIN, "-version"], capture_output=True,
                             text=True, encoding="utf-8", errors="replace", timeout=10)
        first = out.stdout.splitlines()[0] if out.stdout else "unknown"
        m = re.search(r"ffmpeg version (\S+)", first)
        return jsonify({"ok": True, "version": m.group(1) if m else first, "bin": FFMPEG_BIN})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/hw-encoders")
def api_hw_encoders():
    """实测各硬件编码器是否可用（1 帧试编码，快速失败）"""
    encoders = ["h264_nvenc", "hevc_nvenc", "h264_qsv", "hevc_qsv", "h264_amf", "hevc_amf"]
    result = {}
    for enc in encoders:
        try:
            r = subprocess.run(
                [FFMPEG_BIN, "-hide_banner", "-v", "error", "-f", "lavfi",
                 "-i", "color=c=black:s=64x64:d=0.1", "-frames:v", "1",
                 "-c:v", enc, "-f", "null", "-"],
                capture_output=True, text=True, timeout=15)
            result[enc] = (r.returncode == 0)
        except Exception:
            result[enc] = False
    return jsonify({"ok": True, "encoders": result})


@app.route("/api/probe", methods=["POST"])
def api_probe():
    path = (request.json or {}).get("path", "").strip().strip('"')
    if not path or not os.path.exists(path):
        return jsonify({"ok": False, "error": "文件不存在: " + path})
    try:
        out = subprocess.run(
            [FFPROBE_BIN, "-v", "quiet", "-print_format", "json",
             "-show_format", "-show_streams", path],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
        data = json.loads(out.stdout or "{}")
        return jsonify({"ok": True, "data": data})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/browse", methods=["POST"])
def api_browse():
    """通过 PowerShell 脚本弹出 Windows 原生文件对话框（置顶显示）"""
    body = request.json or {}
    mode = body.get("mode", "open")          # open | save | folder
    flt = body.get("filter", "所有文件 (*.*)|*.*")
    multi = bool(body.get("multi"))

    ps_exe = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
    if not os.path.exists(ps_exe):
        ps_exe = "powershell"
    script = os.path.join(BASE_DIR, "browse_dialog.ps1")
    cmd = [ps_exe, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass",
           "-File", script, "-Mode", mode, "-Filter", flt]
    if multi:
        cmd.append("-Multi")
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        paths = [p.strip() for p in out.stdout.splitlines() if p.strip()]
        if out.returncode != 0 or (out.stderr and out.stderr.strip()):
            return jsonify({"ok": False,
                            "error": (out.stderr or "对话框启动失败").strip()[:500]})
        return jsonify({"ok": True, "paths": paths})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/upload", methods=["POST"])
def api_upload():
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "无文件"})
    name = f.filename or ("upload_%s" % uuid.uuid4().hex[:8])
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    dst = os.path.join(UPLOAD_DIR, "%s_%s" % (uuid.uuid4().hex[:6], name))
    f.save(dst)
    return jsonify({"ok": True, "path": dst})


@app.route("/api/concat-list", methods=["POST"])
def api_concat_list():
    """为 concat demuxer 生成临时列表文件"""
    files = (request.json or {}).get("files", [])
    files = [f.strip().strip('"') for f in files if f.strip()]
    if len(files) < 2:
        return jsonify({"ok": False, "error": "至少需要 2 个文件"})
    fd, list_path = tempfile.mkstemp(prefix="concat_", suffix=".txt")
    with os.fdopen(fd, "w", encoding="utf-8") as fp:
        for p in files:
            fp.write("file '%s'\n" % p.replace("'", "'\\''"))
    return jsonify({"ok": True, "path": list_path, "count": len(files)})


# ---------------- 网页视频 / HLS：分片扫描 + 播放列表解析 ----------------
DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
SEGMENT_EXTS = [".ts", ".m4s", ".m4v", ".mp4", ".flv", ".aac", ".mp3"]


def _natural_key(name):
    """自然排序：001.ts / 2.ts / 10.ts 按数字大小排，而不是字典序"""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", str(name))]


def _segments_in(folder):
    """扫描分片目录，返回 (分片列表, m3u8 列表, 主扩展名)。
    主扩展名自动判定：有 .ts 就用 .ts（HLS 分片 / 直播回放最常见），否则取数量最多的那种。"""
    try:
        names = os.listdir(folder)
    except OSError:
        return [], [], None
    buckets, m3u8 = {}, []
    for n in names:
        p = os.path.join(folder, n)
        if not os.path.isfile(p):
            continue
        ext = os.path.splitext(n)[1].lower()
        if ext == ".m3u8":
            m3u8.append(p)
        elif ext in SEGMENT_EXTS:
            buckets.setdefault(ext, []).append(p)
    m3u8.sort(key=lambda p: _natural_key(os.path.basename(p)))
    if not buckets:
        return [], m3u8, None
    main_ext = ".ts" if ".ts" in buckets else max(buckets, key=lambda e: len(buckets[e]))
    files = sorted(buckets[main_ext], key=lambda p: _natural_key(os.path.basename(p)))
    return files, m3u8, main_ext


@app.route("/api/scan-dir", methods=["POST"])
def api_scan_dir():
    """扫描文件夹里的分片，给前端一个「找到了多少个」的即时反馈"""
    d = ((request.json or {}).get("dir") or "").strip().strip('"')
    if not d or not os.path.isdir(d):
        return jsonify({"ok": False, "error": "文件夹不存在：%s" % (d or "(未填写)")})
    files, m3u8, ext = _segments_in(d)
    total = 0
    for p in files:
        try:
            total += os.path.getsize(p)
        except OSError:
            pass
    exts = set()
    try:
        for n in os.listdir(d):
            if os.path.isfile(os.path.join(d, n)):
                exts.add(os.path.splitext(n)[1].lower())
    except OSError:
        pass
    return jsonify({"ok": True, "dir": d, "count": len(files), "total": total,
                    "ext": ext or "",
                    "first": os.path.basename(files[0]) if files else "",
                    "last": os.path.basename(files[-1]) if files else "",
                    "m3u8": m3u8[0] if m3u8 else "",
                    "m3u8_count": len(m3u8),
                    "found_exts": sorted(e for e in exts if e)[:8]})


@app.route("/api/ts-list", methods=["POST"])
def api_ts_list():
    """把文件夹里的分片按顺序写成 concat demuxer 的列表文件"""
    d = ((request.json or {}).get("dir") or "").strip().strip('"')
    if not d or not os.path.isdir(d):
        return jsonify({"ok": False, "error": "文件夹不存在：%s" % (d or "(未填写)")})
    files, m3u8, ext = _segments_in(d)
    if not files:
        return jsonify({"ok": False,
                        "error": "这个文件夹里没找到 .ts / .m4s / .mp4 之类的分片文件"})
    fd, list_path = tempfile.mkstemp(prefix="segconcat_", suffix=".txt")
    total = 0
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fp:
        for p in files:
            fp.write("file '%s'\n" % p.replace("'", "'\\''"))
            try:
                total += os.path.getsize(p)
            except OSError:
                pass
    return jsonify({"ok": True, "path": list_path, "count": len(files), "ext": ext,
                    "total": total, "m3u8": m3u8[0] if m3u8 else "",
                    "first": os.path.basename(files[0]),
                    "last": os.path.basename(files[-1])})


def _fetch_m3u8(url, headers, ua, timeout=25):
    """读取播放列表文本，返回 (文本, 最终 URL)。支持 http(s) 与本地文件。"""
    if re.match(r"^https?://", url, re.I):
        h = {"User-Agent": ua or DEFAULT_UA, "Accept": "*/*"}
        for line in re.split(r"[\r\n]+", headers or ""):
            if ":" in line:
                k, v = line.split(":", 1)
                if k.strip():
                    h[k.strip()] = v.strip()
        try:
            with urlopen(Request(url, headers=h), timeout=timeout) as r:
                return r.read().decode("utf-8", "replace"), r.geturl()
        except HTTPError as e:
            hint = {401: "需要登录（试试填 Cookie）", 403: "被防盗链拦了（试试填 Referer）",
                    404: "地址不存在（可能已过期）", 410: "地址已失效",
                    502: "网关异常（若开着系统代理，可尝试关掉或加直连例外）",
                    503: "服务暂不可用，稍后再试"}.get(
                        e.code, "服务器拒绝访问")
            raise RuntimeError("HTTP %s —— %s" % (e.code, hint))
        except URLError as e:
            raise RuntimeError("连不上服务器（%s），检查网络或是否需要代理" % e.reason)
    p = url
    if p.lower().startswith("file:///"):
        p = unquote(p[8:])
    elif p.lower().startswith("file://"):
        p = unquote(p[7:])
    with open(p, "r", encoding="utf-8", errors="replace") as f:
        return f.read(), url


def _resolve_playlist_url(base_url, orig_url, rel):
    if re.match(r"^https?://", rel, re.I):
        return rel
    if re.match(r"^https?://", base_url or "", re.I):
        return urljoin(base_url, rel)
    folder = os.path.dirname(orig_url)
    return os.path.normpath(os.path.join(folder, rel.replace("/", os.sep)))


def _parse_variants(text, base_url, orig_url):
    """解析 master 播放列表里的多码率变体（#EXT-X-STREAM-INF）"""
    lines = [l.strip() for l in text.splitlines()]
    variants = []
    for i, line in enumerate(lines):
        if not line.startswith("#EXT-X-STREAM-INF"):
            continue
        bw = re.search(r"BANDWIDTH=(\d+)", line)
        res = re.search(r"RESOLUTION=([0-9]+x[0-9]+)", line)
        nxt = ""
        for j in range(i + 1, min(i + 5, len(lines))):
            if lines[j] and not lines[j].startswith("#"):
                nxt = lines[j]
                break
        if not nxt:
            continue
        mbps = ("%.1f Mbps" % (int(bw.group(1)) / 1e6)) if bw else "未知码率"
        variants.append({
            "bandwidth": int(bw.group(1)) if bw else 0,
            "resolution": res.group(1) if res else "",
            "label": "%s · %s" % (res.group(1) if res else "未知分辨率", mbps),
            "url": _resolve_playlist_url(base_url, orig_url, nxt),
        })
    return variants


@app.route("/api/m3u8-resolve", methods=["POST"])
def api_m3u8_resolve():
    """读取 m3u8：判断是 master 还是分片列表，可按需选出最高码率的子列表"""
    body = request.json or {}
    url = (body.get("url") or "").strip().strip('"')
    headers = body.get("headers") or ""
    ua = (body.get("ua") or "").strip()
    quality = body.get("quality") or "auto"
    if not url:
        return jsonify({"ok": False, "error": "请填写播放列表地址"})
    try:
        text, final_url = _fetch_m3u8(url, headers, ua)
    except Exception as e:
        return jsonify({"ok": False, "error": "读取播放列表失败：%s" % e})
    if "#EXTM3U" not in text[:200]:
        return jsonify({"ok": False, "error": "返回的内容不是 m3u8 播放列表（可能需要 Referer / Cookie，或链接已失效）"})

    variants = _parse_variants(text, final_url, url)
    encrypted = ""
    m = re.search(r"#EXT-X-(?:SESSION-)?KEY:.*?METHOD=([A-Za-z0-9-]+)", text)
    if m and m.group(1).upper() != "NONE":
        encrypted = m.group(1).upper()
    segs = len(re.findall(r"^#EXTINF:", text, re.M))
    duration = 0.0
    for x in re.findall(r"^#EXTINF:([0-9.]+)", text, re.M):
        try:
            duration += float(x)
        except ValueError:
            pass

    chosen = None
    if variants:
        chosen = max(variants, key=lambda v: v["bandwidth"]) if quality == "highest" else variants[0]
    return jsonify({"ok": True, "is_master": bool(variants),
                    "variant_count": len(variants), "variants": variants[:10],
                    "selected": chosen,
                    "url": (chosen or {}).get("url", final_url),
                    "encrypted": encrypted, "segments": segs,
                    "duration": round(duration, 1)})


def _reader_thread(task_id, proc, q):
    """读取 ffmpeg stderr(进度) + stdout，放入队列"""
    try:
        for line in iter(proc.stderr.readline, ""):
            if line:
                q.put(("log", line.rstrip("\r\n")))
        proc.wait()
        q.put(("exit", proc.returncode))
    except Exception as e:
        q.put(("log", "[读取错误] %s" % e))
        q.put(("exit", -1))
    finally:
        # 进程已退出，释放 stdin 管道句柄
        try:
            if proc.stdin and not proc.stdin.closed:
                proc.stdin.close()
        except Exception:
            pass


def _stop_watchdog(task_id, proc, grace=12.0, hard=4.0):
    """优雅停止的兜底：q 发出后长时间不收尾，则升级 terminate → kill"""
    try:
        proc.wait(timeout=grace)
        return
    except subprocess.TimeoutExpired:
        pass
    with TASKS_LOCK:
        task = TASKS.get(task_id)
    if task and task.get("force"):
        return
    try:
        proc.terminate()
    except Exception:
        return
    try:
        proc.wait(timeout=hard)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        proc.kill()
    except Exception:
        pass


@app.route("/api/run", methods=["POST"])
def api_run():
    """执行命令。body: {argv: [...], display: '完整命令字符串', cwd: '可选工作目录'}"""
    body = request.json or {}
    argv = body.get("argv", [])
    if not argv or not isinstance(argv, list):
        return jsonify({"ok": False, "error": "缺少命令参数"})
    argv = [str(a) for a in argv]
    full_cmd = [FFMPEG_BIN, "-hide_banner", "-y"] + argv

    # 工作目录：DASH 等封装器会把分片写到进程 cwd，指到输出目录才不会散落
    cwd = (body.get("cwd") or "").strip()
    if not cwd or not os.path.isdir(cwd):
        cwd = None   # 空字符串传给 Windows Popen 会报 WinError 123

    task_id = uuid.uuid4().hex[:12]
    q = queue.Queue()
    try:
        proc = subprocess.Popen(
            full_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            # stdin 管道：停止时写 q 让 ffmpeg 自己收尾（写完 moov 索引再退出），
            # 否则 MP4/MOV 被强杀会留下无索引的坏文件
            stdin=subprocess.PIPE,
            cwd=cwd,
            text=True, encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
    except Exception as e:
        return jsonify({"ok": False, "error": "启动失败: %s" % e})

    with TASKS_LOCK:
        TASKS[task_id] = {"proc": proc, "queue": q, "done": False, "code": None,
                          "stopped": False, "force": False}
    threading.Thread(target=_reader_thread, args=(task_id, proc, q), daemon=True).start()
    return jsonify({"ok": True, "id": task_id})


@app.route("/api/stream/<task_id>")
def api_stream(task_id):
    def gen():
        with TASKS_LOCK:
            task = TASKS.get(task_id)
        if not task:
            yield "data: %s\n\n" % json.dumps({"type": "exit", "code": -1})
            return
        q = task["queue"]
        while True:
            try:
                kind, payload = q.get(timeout=30)
            except queue.Empty:
                yield ": ping\n\n"
                continue
            if kind == "log":
                yield "data: %s\n\n" % json.dumps({"type": "log", "line": payload}, ensure_ascii=False)
            else:
                with TASKS_LOCK:
                    task["done"] = True
                    task["code"] = payload
                yield "data: %s\n\n" % json.dumps(
                    {"type": "exit", "code": payload,
                     "stopped": bool(task.get("stopped"))})
                break
    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/stop", methods=["POST"])
def api_stop():
    """停止任务。默认发 q 让 ffmpeg 正常收尾（文件可播），force=True 直接杀进程"""
    body = request.json or {}
    task_id = body.get("id", "")
    force = bool(body.get("force"))
    with TASKS_LOCK:
        task = TASKS.get(task_id)
    if not task or task["done"]:
        return jsonify({"ok": True, "already": True})

    proc = task["proc"]
    task["stopped"] = True

    if force:
        task["force"] = True
        try:
            proc.kill()
        except Exception:
            pass
        return jsonify({"ok": True, "mode": "kill"})

    # 首选：向 stdin 写 q —— ffmpeg 会停止读流、写完文件索引后正常退出
    mode = "graceful"
    try:
        if proc.stdin and not proc.stdin.closed:
            proc.stdin.write("q")
            proc.stdin.flush()
        else:
            raise RuntimeError("stdin 不可用")
    except Exception:
        mode = "terminate"
        try:
            proc.terminate()
        except Exception:
            pass

    threading.Thread(target=_stop_watchdog, args=(task_id, proc), daemon=True).start()
    return jsonify({"ok": True, "mode": mode})


@app.route("/api/outputs")
def api_outputs():
    files = []
    for name in sorted(os.listdir(OUTPUT_DIR), reverse=True)[:50]:
        p = os.path.join(OUTPUT_DIR, name)
        if os.path.isfile(p):
            files.append({"name": name, "path": p,
                          "size": os.path.getsize(p),
                          "mtime": os.path.getmtime(p)})
    return jsonify({"ok": True, "files": files, "dir": OUTPUT_DIR})


if __name__ == "__main__":
    print("=" * 50)
    print("  FFmpeg Studio 已启动")
    print("  请在浏览器打开: http://127.0.0.1:8558")
    print("=" * 50)
    app.run(host="127.0.0.1", port=8558, threaded=True)
