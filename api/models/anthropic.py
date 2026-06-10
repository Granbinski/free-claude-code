"""Pydantic models for Anthropic-compatible requests."""

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


# =============================================================================
# Content Block Types
# =============================================================================
class Role(StrEnum):
    user = "user"
    assistant = "assistant"
    system = "system"


class _AnthropicBlockBase(BaseModel):
    """Pass through provider fields (e.g. ``cache_control``) for native transports."""

    model_config = ConfigDict(extra="allow")


class ContentBlockText(_AnthropicBlockBase):
    type: Literal["text"]
    text: str


class ContentBlockImage(_AnthropicBlockBase):
    type: Literal["image"]
    source: dict[str, Any]


class ContentBlockDocument(_AnthropicBlockBase):
    """Anthropic document block (e.g. PDF files via the Files API)."""

    type: Literal["document"]
    source: dict[str, Any]


class ContentBlockToolUse(_AnthropicBlockBase):
    type: Literal["tool_use"]
    id: str
    name: str
    input: dict[str, Any]


class ContentBlockToolResult(_AnthropicBlockBase):
    type: Literal["tool_result"]
    tool_use_id: str
    content: str | list[Any] | dict[str, Any]


class ContentBlockThinking(_AnthropicBlockBase):
    type: Literal["thinking"]
    thinking: str
    signature: str | None = None


class ContentBlockRedactedThinking(_AnthropicBlockBase):
    type: Literal["redacted_thinking"]
    data: str


class ContentBlockServerToolUse(_AnthropicBlockBase):
    """Anthropic server-side tool invocation (e.g. ``web_search``, ``web_fetch``)."""

    type: Literal["server_tool_use"]
    id: str
    name: str
    input: dict[str, Any]


class ContentBlockWebSearchToolResult(_AnthropicBlockBase):
    type: Literal["web_search_tool_result"]
    tool_use_id: str
    content: Any


class ContentBlockWebFetchToolResult(_AnthropicBlockBase):
    type: Literal["web_fetch_tool_result"]
    tool_use_id: str
    content: Any


class SystemContent(_AnthropicBlockBase):
    type: Literal["text"]
    text: str


def _system_text_block(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text}


def _system_blocks_from_content(content: Any) -> list[dict[str, Any]] | None:
    """Return system text blocks when a client put system content in messages."""
    if isinstance(content, str):
        return [_system_text_block(content)]
    if not isinstance(content, list):
        return None

    blocks: list[dict[str, Any]] = []
    for block in content:
        if isinstance(block, dict):
            block_type = block.get("type")
            text = block.get("text")
            if block_type == "text" and isinstance(text, str):
                blocks.append(dict(block))
                continue
        return None
    return blocks


def _plain_system_blocks(blocks: list[dict[str, Any]]) -> bool:
    return all(set(block.keys()) == {"type", "text"} for block in blocks)


def _system_blocks_text(blocks: list[dict[str, Any]]) -> str:
    return "\n\n".join(block["text"] for block in blocks if block.get("text"))


def _merge_system_content(
    existing_system: Any, inline_blocks: list[dict[str, Any]]
) -> Any:
    if existing_system is None:
        if _plain_system_blocks(inline_blocks):
            return _system_blocks_text(inline_blocks)
        return inline_blocks

    if isinstance(existing_system, str):
        if _plain_system_blocks(inline_blocks):
            parts = [existing_system, _system_blocks_text(inline_blocks)]
            return "\n\n".join(part for part in parts if part)
        return [_system_text_block(existing_system), *inline_blocks]

    if isinstance(existing_system, list):
        return [*existing_system, *inline_blocks]

    return existing_system


def _normalize_inline_system_messages(data: Any) -> Any:
    """Promote non-standard ``messages[].role == "system"`` into ``system``."""
    if not isinstance(data, dict):
        return data

    messages = data.get("messages")
    if not isinstance(messages, list):
        return data

    inline_blocks: list[dict[str, Any]] = []
    normalized_messages: list[Any] = []
    promoted = False
    for message in messages:
        if isinstance(message, dict) and message.get("role") == "system":
            blocks = _system_blocks_from_content(message.get("content"))
            if blocks is None:
                normalized_messages.append(message)
                continue
            inline_blocks.extend(blocks)
            promoted = True
            continue
        normalized_messages.append(message)

    if not promoted:
        return data

    normalized = dict(data)
    normalized["messages"] = normalized_messages
    if inline_blocks:
        normalized["system"] = _merge_system_content(
            normalized.get("system"), inline_blocks
        )
    return normalized


# =============================================================================
# Message Types
# =============================================================================
class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: (
        str
        | list[
            ContentBlockText
            | ContentBlockImage
            | ContentBlockDocument
            | ContentBlockToolUse
            | ContentBlockToolResult
            | ContentBlockThinking
            | ContentBlockRedactedThinking
            | ContentBlockServerToolUse
            | ContentBlockWebSearchToolResult
            | ContentBlockWebFetchToolResult
        ]
    )
    reasoning_content: str | None = None


class Tool(_AnthropicBlockBase):
    name: str
    # Anthropic server tools (e.g. web_search beta tools) include a ``type`` and
    # may omit ``input_schema`` because the provider owns the schema.
    type: str | None = None
    description: str | None = None
    input_schema: dict[str, Any] | None = None


class ThinkingConfig(BaseModel):
    enabled: bool | None = True
    type: str | None = None
    budget_tokens: int | None = None


# =============================================================================
# Request Models
# =============================================================================
class _InlineSystemMessageNormalizer(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def _promote_inline_system_messages(cls, data: Any) -> Any:
        return _normalize_inline_system_messages(data)


class MessagesRequest(_InlineSystemMessageNormalizer):
    model_config = ConfigDict(extra="allow")

    model: str
    # Internal routing / debug: accepted on parse but not serialized to providers.
    original_model: str | None = Field(default=None, exclude=True)
    resolved_provider_model: str | None = Field(default=None, exclude=True)
    max_tokens: int | None = None
    messages: list[Message]
    system: str | list[SystemContent] | None = None
    stop_sequences: list[str] | None = None
    stream: bool | None = True
    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    metadata: dict[str, Any] | None = None
    tools: list[Tool] | None = None
    tool_choice: dict[str, Any] | None = None
    thinking: ThinkingConfig | None = None
    # Native Anthropic / SDK client hints: ignored (not forwarded) for OpenAI Chat conversion.
    context_management: dict[str, Any] | None = None
    output_config: dict[str, Any] | None = None
    mcp_servers: list[dict[str, Any]] | None = None
    extra_body: dict[str, Any] | None = None
    # Beta feature flags sent by Claude Code as a body field; accepted but never forwarded.
    betas: list[str] | None = Field(default=None, exclude=True)


class TokenCountRequest(_InlineSystemMessageNormalizer):
    model_config = ConfigDict(extra="allow")

    model: str
    original_model: str | None = Field(default=None, exclude=True)
    resolved_provider_model: str | None = Field(default=None, exclude=True)
    messages: list[Message]
    system: str | list[SystemContent] | None = None
    tools: list[Tool] | None = None
    thinking: ThinkingConfig | None = None
    tool_choice: dict[str, Any] | None = None
    context_management: dict[str, Any] | None = None
    output_config: dict[str, Any] | None = None
    mcp_servers: list[dict[str, Any]] | None = None
    betas: list[str] | None = Field(default=None, exclude=True)
