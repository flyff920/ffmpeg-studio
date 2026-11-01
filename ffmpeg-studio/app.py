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
    mode = body.get("mode", "open")          # open | save
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
