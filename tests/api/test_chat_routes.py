from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from api.app import create_app
from providers.nvidia_nim import NvidiaNimProvider


async def _mock_stream_response(*args, **kwargs):
    yield 'event: message_start\ndata: {"type":"message_start"}\n\n'
    yield (
        "event: content_block_start\n"
        'data: {"type":"content_block_start","index":0,'
        '"content_block":{"type":"text","text":""}}\n\n'
    )
    yield (
        "event: content_block_delta\n"
        'data: {"type":"content_block_delta","index":0,'
        '"delta":{"type":"text_delta","text":"Resposta local"}}\n\n'
    )
    yield 'event: message_stop\ndata: {"type":"message_stop"}\n\n'


def test_chat_state_creates_local_store(tmp_path, monkeypatch):
    import api.chat_store as chat_store_mod

    monkeypatch.setattr(
        chat_store_mod, "chat_state_path", lambda: tmp_path / "state.json"
    )
    app = create_app(lifespan_enabled=False)

    with patch("api.chat_routes.require_loopback_admin"), TestClient(app) as client:
        response = client.get("/chat/api/state")

    assert response.status_code == 200
    body = response.json()
    assert body["state"]["settings"]["active_prompt_id"] == "default"
    assert body["runtime"]["chat_state_path"].endswith("state.json")
    assert (tmp_path / "state.json").is_file()


def test_chat_send_persists_history_and_uses_memories(tmp_path, monkeypatch):
    import api.chat_store as chat_store_mod

    monkeypatch.setattr(
        chat_store_mod, "chat_state_path", lambda: tmp_path / "state.json"
    )
    app = create_app(lifespan_enabled=False)
    mock_provider = MagicMock(spec=NvidiaNimProvider)
    mock_provider.stream_response = _mock_stream_response
    captured = {}

    def _preflight(request, *args, **kwargs):
        captured["request"] = request

    mock_provider.preflight_stream = _preflight

    with (
        patch("api.dependencies.resolve_provider", return_value=mock_provider),
        patch("api.chat_routes.require_loopback_admin"),
        patch(
            "providers.registry.ProviderRegistry.validate_configured_models",
            new_callable=AsyncMock,
        ),
        patch("providers.registry.ProviderRegistry.start_model_list_refresh"),
        TestClient(app) as client,
    ):
        conversation_resp = client.post(
            "/chat/api/conversations", json={"title": "Teste"}
        )
        conversation_id = conversation_resp.json()["conversation"]["id"]
        client.post(
            "/chat/api/memories",
            json={
                "title": "Preferencia",
                "content": "Responder com estrategia.",
                "enabled": True,
            },
        )
        response = client.post(
            f"/chat/api/conversations/{conversation_id}/messages",
            json={"content": "Ola"},
        )
        state_response = client.get("/chat/api/state")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: delta" in response.text
    assert "Resposta local" in response.text
    assert "event: done" in response.text

    body = state_response.json()
    conversation = body["state"]["conversations"][0]
    assert [message["role"] for message in conversation["messages"]] == [
        "user",
        "assistant",
    ]
    assert conversation["messages"][1]["content"] == "Resposta local"
    assert "Responder com estrategia." in captured["request"].system


def test_chat_projects_attachments_branches_and_regeneration(tmp_path, monkeypatch):
    import api.chat_store as chat_store_mod

    monkeypatch.setattr(
        chat_store_mod, "chat_state_path", lambda: tmp_path / "state.json"
    )
    app = create_app(lifespan_enabled=False)
    mock_provider = MagicMock(spec=NvidiaNimProvider)
    mock_provider.stream_response = _mock_stream_response
    captured = {}

    def _preflight(request, *args, **kwargs):
        captured.setdefault("systems", []).append(request.system)

    mock_provider.preflight_stream = _preflight

    with (
        patch("api.dependencies.resolve_provider", return_value=mock_provider),
        patch("api.chat_routes.require_loopback_admin"),
        patch(
            "providers.registry.ProviderRegistry.validate_configured_models",
            new_callable=AsyncMock,
        ),
        patch("providers.registry.ProviderRegistry.start_model_list_refresh"),
        TestClient(app) as client,
    ):
        project_resp = client.post("/chat/api/projects", json={"title": "Pesquisa"})
        project_id = project_resp.json()["project"]["id"]
        conversation_resp = client.post(
            "/chat/api/conversations",
            json={
                "title": "Com anexos",
                "project_id": project_id,
                "labels": ["codigo", "logs"],
            },
        )
        conversation = conversation_resp.json()["conversation"]
        conversation_id = conversation["id"]
        client.post(
            f"/chat/api/conversations/{conversation_id}/attachments",
            json={
                "name": "arquivo.txt",
                "content": "conteudo local importante",
                "content_type": "text/plain",
            },
        )
        send_response = client.post(
            f"/chat/api/conversations/{conversation_id}/messages",
            json={"content": "Use o anexo"},
        )
        state_response = client.get("/chat/api/state")
        user_message_id = state_response.json()["state"]["conversations"][0][
            "messages"
        ][0]["id"]
        branch_response = client.post(
            f"/chat/api/conversations/{conversation_id}/branch",
            json={
                "message_id": user_message_id,
                "edited_content": "Use o anexo editado",
            },
        )
        branch = branch_response.json()["conversation"]
        regenerate_response = client.post(
            f"/chat/api/conversations/{branch['id']}/regenerate",
            json={"message_id": branch_response.json()["focus_message_id"]},
        )

    assert send_response.status_code == 200
    assert "conteudo local importante" in captured["systems"][0]
    assert "dados fornecidos pelo usuario" in captured["systems"][0]
    assert branch["parent_id"] == conversation_id
    assert branch["labels"] == ["codigo", "logs"]
    assert branch["messages"][0]["content"] == "Use o anexo editado"
    assert regenerate_response.status_code == 200
    assert "event: delta" in regenerate_response.text


def test_chat_static_page_serves(tmp_path, monkeypatch):
    import api.chat_store as chat_store_mod

    monkeypatch.setattr(
        chat_store_mod, "chat_state_path", lambda: tmp_path / "state.json"
    )
    app = create_app(lifespan_enabled=False)

    with patch("api.chat_routes.require_loopback_admin"), TestClient(app) as client:
        page = client.get("/chat")
        script = client.get("/chat/assets/chat.js")
        style = client.get("/chat/assets/chat.css")

    assert page.status_code == 200
    assert script.status_code == 200
    assert style.status_code == 200
    assert "copy-code" in script.text
    assert "conversation-delete" in script.text
    assert "renderMessageContent" in script.text
    assert "stopGeneration" in script.text
    assert "branchFromMessage" in script.text
