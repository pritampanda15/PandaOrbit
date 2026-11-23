#!/usr/bin/env python3
"""
PandaOrbit / HabitBoard Standalone Activity Tracker (Python).

Cross-platform foreground window logger writing to the exact HabitBoard
SQLite schema (`activity_sessions`) so it works seamlessly alongside the
PandaOrbit Node dashboard or existing HabitBoard setups.

Usage:
    python3 tracker/backend.py
    python3 tracker/backend.py --db ~/.panda-orbit/activity_tracker.db --interval 2
"""

import argparse
import os
import platform
import sqlite3
import subprocess
import time

DEFAULT_DB = os.path.expanduser("~/.panda-orbit/activity_tracker.db")


def initialize_database(db_path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    db_exists = os.path.exists(db_path)
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS activity_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_time REAL NOT NULL,
            end_time REAL NOT NULL,
            duration REAL NOT NULL,
            app_name TEXT NOT NULL,
            window_title TEXT
        );
        """
    )
    conn.commit()
    conn.close()
    state = "Connected to existing" if db_exists else "Created new"
    print(f"[PandaOrbit] {state} database: {db_path}")


def log_activity(db_path: str, start_time: float, end_time: float, app_name: str, window_title: str) -> None:
    duration = end_time - start_time
    if duration < 1.0 or not app_name:
        return
    conn = None
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO activity_sessions (start_time, end_time, duration, app_name, window_title)
            VALUES (?, ?, ?, ?, ?);
            """,
            (start_time, end_time, duration, app_name, window_title),
        )
        conn.commit()
        mins, secs = divmod(int(duration), 60)
        print(f"  logged: {app_name} ({mins}m {secs}s) — {window_title}")
    except sqlite3.Error as exc:
        print(f"  sqlite error: {exc}")
    finally:
        if conn:
            conn.close()


def get_active_window_macos():
    script = """
    tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        set winTitle to ""
        try
            set winTitle to name of front window of frontApp
        end try
        return appName & linefeed & winTitle
    end tell
    """
    res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=2)
    if res.returncode != 0:
        return None, None
    lines = res.stdout.strip().splitlines()
    app_name = lines[0].strip() if lines else "Unknown"
    win_title = " ".join(lines[1:]).strip() if len(lines) > 1 else app_name
    return app_name, win_title or app_name


def make_linux_reader():
    from Xlib import display
    from Xlib.X import AnyPropertyType

    disp = display.Display()

    def read_window():
        root = disp.screen().root
        prop = root.get_full_property(disp.intern_atom("_NET_ACTIVE_WINDOW"), AnyPropertyType)
        if not prop or not prop.value:
            return None, None
        window = disp.create_resource_object("window", prop.value[0])
        title_prop = window.get_full_property(disp.intern_atom("_NET_WM_NAME"), 0)
        window_title = title_prop.value.decode("utf-8", "ignore") if title_prop else ""
        pid_prop = window.get_full_property(disp.intern_atom("_NET_WM_PID"), AnyPropertyType)
        app_name = "Unknown"
        if pid_prop and pid_prop.value:
            pid = pid_prop.value[0]
            try:
                with open(f"/proc/{pid}/cmdline", "r", encoding="utf-8", errors="ignore") as f:
                    parts = f.read().split("\x00")
                    app_name = parts[0].split("/")[-1] if parts and parts[0] else "Unknown"
            except Exception:
                app_name = "System Process"
        return app_name, window_title or app_name

    return read_window


def run_tracker(db_path: str, interval: float) -> None:
    system = platform.system()
    if system == "Darwin":
        reader = get_active_window_macos
    elif system == "Linux":
        reader = make_linux_reader()
    else:
        raise RuntimeError(f"Unsupported OS for Python tracker: {system}. Use `panda-orbit track` instead.")

    current_app = ""
    current_title = ""
    session_start = time.time()

    print(f"[PandaOrbit] Activity Tracker running on {system} (poll {interval}s). Press Ctrl+C to stop.")
    try:
        while True:
            try:
                app_name, window_title = reader()
                if app_name and (window_title != current_title or app_name != current_app):
                    now = time.time()
                    if current_app:
                        log_activity(db_path, session_start, now, current_app, current_title)
                    session_start = now
                    current_app = app_name
                    current_title = window_title or app_name
                    print(f"-> {current_app} | {current_title} ({time.strftime('%H:%M:%S')})")
            except Exception:
                pass
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\n[PandaOrbit] Tracker stopped. Flushing final session...")
        log_activity(db_path, session_start, time.time(), current_app, current_title)


def main():
    parser = argparse.ArgumentParser(description="PandaOrbit / HabitBoard activity tracker daemon")
    parser.add_argument("--db", default=DEFAULT_DB, help=f"SQLite DB path (default: {DEFAULT_DB})")
    parser.add_argument("--interval", type=float, default=2.0, help="Polling interval in seconds (default: 2.0)")
    args = parser.parse_args()
    initialize_database(args.db)
    run_tracker(args.db, args.interval)


if __name__ == "__main__":
    main()
