"""Local browser chat persistence."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4

from config.paths import config_dir_path

CHAT_DIRNAME = "browser_chat"
CHAT_STATE_FILENAME = "state.json"


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def chat_state_path() -> Path:
    return config_dir_path() / CHAT_DIRNAME / CHAT_STATE_FILENAME


def default_state() -> dict[str, Any]:
    now = utc_now()
    return {
        "version": 2,
        "settings": {
            "active_prompt_id": "default",
            "default_system_prompt": (
                "Voce e um assistente local, direto, cuidadoso e pragmatico."
            ),
            "include_personal_memories": True,
            "include_conversation_memory": True,
            "history_limit": 30,
            "model": "",
            "theme": "light",
        },
        "projects": [
            {
                "id": "default",
                "title": "Geral",
                "created_at": now,
                "updated_at": now,
            }
        ],
        "personal_memories": [],
        "custom_prompts": [
            {
                "id": "default",
                "title": "Padrao local",
                "content": (
                    "Responda em portugues do Brasil quando o usuario escrever em "
                    "portugues. Seja claro, operacional e preserve contexto local."
                ),
                "enabled": True,
                "created_at": now,
                "updated_at": now,
            }
        ],
        "conversations": [],
    }


class ChatStore:
    """JSON-backed local state for browser chat."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path
        self._lock = RLock()

    @property
    def path(self) -> Path:
        return self._path or chat_state_path()

    def load(self) -> dict[str, Any]:
        with self._lock:
            path = self.path
            if not path.exists():
                state = default_state()
                self._write_state(state)
                return deepcopy(state)

            try:
                with path.open("r", encoding="utf-8") as handle:
                    raw = json.load(handle)
            except json.JSONDecodeError, OSError:
                raw = {}
            state = normalize_state(raw)
            self._write_state(state)
            return deepcopy(state)

    def save(self, state: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            normalized = normalize_state(state)
            self._write_state(normalized)
            return deepcopy(normalized)

    def _write_state(self, state: dict[str, Any]) -> None:
        path = self.path
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(".tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
        temp_path.replace(path)


def normalize_state(raw: Any) -> dict[str, Any]:
    base = default_state()
    if not isinstance(raw, dict):
        return base

    state = deepcopy(base)
    try:
        state["version"] = max(int(raw.get("version") or 1), base["version"])
    except TypeError, ValueError:
        state["version"] = base["version"]
    if isinstance(raw.get("settings"), dict):
        state["settings"].update(_clean_settings(raw["settings"]))
    if isinstance(raw.get("projects"), list):
        projects = [
            item
            for item in (_clean_project(project) for project in raw["projects"])
            if item is not None
        ]
        if projects:
            state["projects"] = projects
    if isinstance(raw.get("personal_memories"), list):
        state["personal_memories"] = [
            item
            for item in (_clean_memory(memory) for memory in raw["personal_memories"])
            if item is not None
        ]
    if isinstance(raw.get("custom_prompts"), list):
        prompts = [
            item
            for item in (_clean_prompt(prompt) for prompt in raw["custom_prompts"])
            if item is not None
        ]
        if prompts:
            state["custom_prompts"] = prompts
    if isinstance(raw.get("conversations"), list):
        state["conversations"] = [
            item
            for item in (
                _clean_conversation(conversation)
                for conversation in raw["conversations"]
            )
            if item is not None
        ]
    return state


def _clean_settings(raw: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key in (
        "active_prompt_id",
        "default_system_prompt",
        "include_personal_memories",
        "include_conversation_memory",
        "history_limit",
        "model",
        "theme",
    ):
        if key in raw:
            cleaned[key] = raw[key]
    if "history_limit" in cleaned:
        try:
            cleaned["history_limit"] = max(1, min(80, int(cleaned["history_limit"])))
        except TypeError, ValueError:
            cleaned["history_limit"] = 30
    if "include_personal_memories" in cleaned:
        cleaned["include_personal_memories"] = bool(
            cleaned["include_personal_memories"]
        )
    if "include_conversation_memory" in cleaned:
        cleaned["include_conversation_memory"] = bool(
            cleaned["include_conversation_memory"]
        )
    for key in ("active_prompt_id", "default_system_prompt", "model", "theme"):
        if key in cleaned and cleaned[key] is not None:
            cleaned[key] = str(cleaned[key])
    if cleaned.get("theme") not in {"light", "dark"}:
        cleaned["theme"] = "light"
    return cleaned


def _clean_project(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    now = utc_now()
    title = str(raw.get("title") or "Projeto").strip() or "Projeto"
    return {
        "id": str(raw.get("id") or new_id("project")),
        "title": title,
        "created_at": str(raw.get("created_at") or now),
        "updated_at": str(raw.get("updated_at") or now),
    }


def _clean_memory(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    now = utc_now()
    content = str(raw.get("content") or "").strip()
    title = str(raw.get("title") or "Memoria").strip() or "Memoria"
    if not content and not title:
        return None
    return {
        "id": str(raw.get("id") or new_id("mem")),
        "title": title,
        "content": content,
        "enabled": bool(raw.get("enabled", True)),
        "created_at": str(raw.get("created_at") or now),
        "updated_at": str(raw.get("updated_at") or now),
    }


def _clean_prompt(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    now = utc_now()
    title = str(raw.get("title") or "Prompt").strip() or "Prompt"
    content = str(raw.get("content") or "").strip()
    return {
        "id": str(raw.get("id") or new_id("prompt")),
        "title": title,
        "content": content,
        "enabled": bool(raw.get("enabled", True)),
        "created_at": str(raw.get("created_at") or now),
        "updated_at": str(raw.get("updated_at") or now),
    }


def _clean_conversation(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    now = utc_now()
    title = str(raw.get("title") or "Nova conversa").strip() or "Nova conversa"
    messages = raw.get("messages") if isinstance(raw.get("messages"), list) else []
    attachments = (
        raw.get("attachments") if isinstance(raw.get("attachments"), list) else []
    )
    return {
        "id": str(raw.get("id") or new_id("conv")),
        "title": title,
        "memory": str(raw.get("memory") or ""),
        "project_id": str(raw.get("project_id") or "default"),
        "labels": _clean_labels(raw.get("labels")),
        "parent_id": str(raw["parent_id"]) if raw.get("parent_id") else "",
        "branch_from_message_id": (
            str(raw["branch_from_message_id"])
            if raw.get("branch_from_message_id")
            else ""
        ),
        "archived": bool(raw.get("archived", False)),
        "created_at": str(raw.get("created_at") or now),
        "updated_at": str(raw.get("updated_at") or now),
        "messages": [
            item
            for item in (_clean_message(message) for message in messages)
            if item is not None
        ],
        "attachments": [
            item
            for item in (_clean_attachment(attachment) for attachment in attachments)
            if item is not None
        ],
    }


def _clean_labels(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    labels: list[str] = []
    for value in raw:
        label = str(value or "").strip()
        if label and label not in labels:
            labels.append(label[:40])
    return labels[:12]


def _clean_message(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    role = str(raw.get("role") or "")
    if role not in {"user", "assistant"}:
        return None
    message = {
        "id": str(raw.get("id") or new_id("msg")),
        "role": role,
        "content": str(raw.get("content") or ""),
        "created_at": str(raw.get("created_at") or utc_now()),
    }
    if raw.get("status"):
        message["status"] = str(raw["status"])
    if raw.get("edited_at"):
        message["edited_at"] = str(raw["edited_at"])
    if raw.get("regenerated_from"):
        message["regenerated_from"] = str(raw["regenerated_from"])
    return message


def _clean_attachment(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("name") or "").strip()
    content = str(raw.get("content") or "")
    if not name or not content:
        return None
    now = utc_now()
    return {
        "id": str(raw.get("id") or new_id("att")),
        "name": name[:160],
        "content": content,
        "content_type": str(raw.get("content_type") or "text/plain"),
        "size": max(0, int(raw.get("size") or len(content))),
        "enabled": bool(raw.get("enabled", True)),
        "created_at": str(raw.get("created_at") or now),
        "updated_at": str(raw.get("updated_at") or now),
    }
