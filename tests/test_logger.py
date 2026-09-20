"""Tests for backend.core.logger worker-mode + retention hygiene.

Mutates the global singleton — handlers are saved/restored per test.
"""
import logging
import os
import sys
import time

import pytest

from backend.core import logger as logger_mod


@pytest.fixture()
def _restore_handlers():
    saved = list(logger_mod.logger.handlers)
    try:
        yield
    finally:
        for h in list(logger_mod.logger.handlers):
            if h not in saved:
                try:
                    h.close()
                except Exception:
                    pass
                logger_mod.logger.removeHandler(h)
        for h in saved:
            if h not in logger_mod.logger.handlers:
                logger_mod.logger.addHandler(h)


def test_prune_old_logs_removes_stale_keeps_fresh(tmp_path, monkeypatch,
                                                  _restore_handlers):
    monkeypatch.setattr(logger_mod, "LOGS_DIR", tmp_path)
    monkeypatch.setattr(logger_mod, "LOG_FILE", tmp_path / "app_current.log")
    monkeypatch.setattr(logger_mod, "LOG_RETENTION_DAYS", 7)
    stale = tmp_path / "app_1111.log"
    stale.write_text("old", encoding="utf-8")
    old = time.time() - 8 * 86400
    os.utime(stale, (old, old))
    fresh = tmp_path / "app_2222.log"
    fresh.write_text("new", encoding="utf-8")
    assert logger_mod._prune_old_logs() == 1
    assert not stale.exists() and fresh.exists()


def test_prune_never_removes_current_file(tmp_path, monkeypatch,
                                          _restore_handlers):
    monkeypatch.setattr(logger_mod, "LOGS_DIR", tmp_path)
    monkeypatch.setattr(logger_mod, "LOG_FILE", tmp_path / "app_9999.log")
    monkeypatch.setattr(logger_mod, "LOG_RETENTION_DAYS", 7)
    current = tmp_path / "app_9999.log"
    current.write_text("mine", encoding="utf-8")
    old = time.time() - 30 * 86400
    os.utime(current, (old, old))
    assert logger_mod._prune_old_logs() == 0
    assert current.exists()


def test_configure_stdio_worker_no_stdout_no_file(tmp_path, monkeypatch, _restore_handlers):
    from logging.handlers import RotatingFileHandler
    monkeypatch.setattr(logger_mod, "LOGS_DIR", tmp_path)
    monkeypatch.setattr(logger_mod, "LOG_FILE", tmp_path / "app_stdio.log")
    logger_mod.configure_stdio_worker()
    handlers = logger_mod.logger.handlers
    assert not any(isinstance(h, RotatingFileHandler) for h in handlers)
    assert not any(isinstance(h, logging.StreamHandler)
                   and getattr(h, "stream", None) is sys.stdout
                   for h in handlers)
    assert any(isinstance(h, logging.StreamHandler)
               and getattr(h, "stream", None) is sys.stderr
               for h in handlers)
    logger_mod.logger.info("stdio worker smoke log")


def test_enable_file_logging_round_trip(tmp_path, monkeypatch, _restore_handlers):
    from logging.handlers import RotatingFileHandler
    monkeypatch.setattr(logger_mod, "LOG_FILE", tmp_path / "roundtrip.log")
    logger_mod.disable_file_logging()
    assert not any(isinstance(h, RotatingFileHandler)
                   for h in logger_mod.logger.handlers)
    logger_mod.enable_file_logging()
    assert sum(isinstance(h, RotatingFileHandler)
               for h in logger_mod.logger.handlers) == 1
    logger_mod.enable_file_logging()  # idempotent, no duplicate handler
    assert sum(isinstance(h, RotatingFileHandler)
               for h in logger_mod.logger.handlers) == 1


def test_get_log_retention_days_fallback(monkeypatch):
    monkeypatch.setenv("NARRATO_LOG_RETENTION_DAYS", "invalid_value")
    assert logger_mod._get_log_retention_days() == 7
    monkeypatch.setenv("NARRATO_LOG_RETENTION_DAYS", "-3")
    assert logger_mod._get_log_retention_days() == 0
    monkeypatch.setenv("NARRATO_LOG_RETENTION_DAYS", "14")
    assert logger_mod._get_log_retention_days() == 14


def test_prune_preserves_current_process_rotated_backups(tmp_path, monkeypatch, _restore_handlers):
    monkeypatch.setattr(logger_mod, "LOGS_DIR", tmp_path)
    current_file = tmp_path / "app_1234.log"
    monkeypatch.setattr(logger_mod, "LOG_FILE", current_file)
    monkeypatch.setattr(logger_mod, "LOG_RETENTION_DAYS", 7)
    
    # Simulate a rotated backup for the current process
    rotated = tmp_path / "app_1234.log.1"
    rotated.write_text("backup", encoding="utf-8")
    old = time.time() - 30 * 86400
    os.utime(rotated, (old, old))
    
    assert logger_mod._prune_old_logs() == 0
    assert rotated.exists()

