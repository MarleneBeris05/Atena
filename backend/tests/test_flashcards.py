import json
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from google import genai
from httpx2 import ConnectError, MockTransport, ReadTimeout, Response

from atena.gemini import request_drafts


TEST_DATABASE = os.getenv("ATENA_TEST_DATABASE_URL")
MODEL = "gemini-3.5-flash-lite"
NOTES = "La estrella usa un conmutador. En una red de bus todos comparten el mismo medio."
STAR = {"question": "¿Qué usa una topología en estrella?", "answer": "Un conmutador.",
        "source": "La estrella usa un conmutador."}
BUS = {"question": "¿Qué comparten los nodos de un bus?", "answer": "El mismo medio.",
       "source": "En una red de bus todos comparten el mismo medio."}


class GeminiTransportTest(unittest.TestCase):
    def test_sdk_schema_input_and_error_mapping(self):
        original_client = genai.Client
        requests = []

        def transport(behavior):
            def handle(request):
                requests.append(request)
                if behavior == "timeout":
                    raise ReadTimeout("simulated", request=request)
                if behavior == "transport":
                    raise ConnectError("simulated", request=request)
                if behavior == "quota":
                    return Response(429, json={"error": {"code": 429, "message": "simulated",
                                                        "status": "RESOURCE_EXHAUSTED"}})
                if behavior == "unavailable":
                    return Response(503, json={"error": {"code": 503, "message": "simulated", "status": "UNAVAILABLE"}})
                return Response(200, json={"candidates": [{"finishReason": "STOP", "content": {
                    "role": "model", "parts": [{"text": json.dumps({"drafts": [STAR]})}],
                }}]})
            return MockTransport(handle)

        from fastapi import HTTPException

        for behavior, expected, diagnostic in [
            ("success", None, None),
            ("timeout", (504, "generation_timeout"), "exception_type=ReadTimeout"),
            ("transport", (502, "generation_unavailable"), "exception_type=ConnectError"),
            ("quota", (503, "generation_quota"), "http_status=429"),
            ("unavailable", (503, "generation_provider_unavailable"), "http_status=503 provider_status=UNAVAILABLE"),
        ]:
            def mock_client(**options):
                http_options = options["http_options"]
                self.assertEqual(http_options.timeout, 60_000)
                self.assertEqual(http_options.retry_options.attempts, 1)
                http_options.client_args = {"transport": transport(behavior)}
                return original_client(**options)

            with self.subTest(behavior=behavior), patch("atena.gemini.genai.Client", side_effect=mock_client):
                previous = len(requests)
                if expected:
                    with (
                        patch("atena.gemini.time") as clock,
                        self.assertLogs("atena.gemini", level="WARNING") as logs,
                        self.assertRaises(HTTPException) as error,
                    ):
                        clock.monotonic.side_effect = [10.0, 10.5]
                        request_drafts(NOTES, 5, "test-key", MODEL)
                    self.assertEqual((error.exception.status_code, error.exception.detail), expected)
                    self.assertIn(diagnostic, logs.records[0].getMessage())
                    self.assertIn(f"model={MODEL} elapsed_ms=500", logs.records[0].getMessage())
                    self.assertNotIn("simulated", logs.output[0])
                else:
                    self.assertEqual(json.loads(request_drafts(NOTES, 5, "test-key", MODEL)), {"drafts": [STAR]})
                self.assertEqual(len(requests), previous + 1)

        request = requests[0]
        self.assertIn(MODEL, request.url.path)
        payload = json.loads(request.content)
        self.assertEqual(payload["contents"], [{"parts": [{"text": NOTES}], "role": "user"}])
        self.assertEqual(payload["generationConfig"]["responseMimeType"], "application/json")
        schema = payload["generationConfig"]["responseJsonSchema"]
        self.assertEqual(schema["properties"]["drafts"]["maxItems"], 5)
        self.assertIn("español", payload["systemInstruction"]["parts"][0]["text"])

    def test_logs_original_http_status_without_provider_details(self):
        from fastapi import HTTPException

        original_client = genai.Client
        details = "provider-message private-notes private-model-response test-key private-header"
        for status, expected_status in [("PERMISSION_DENIED", "PERMISSION_DENIED"), (None, "-")]:
            def mock_client(**options):
                def handle(_request):
                    payload = {"code": 400, "message": details}
                    if status is not None:
                        payload["status"] = status
                    return Response(403, json={"error": payload}, headers={"X-Debug": "private-header"})

                options["http_options"].client_args = {"transport": MockTransport(handle)}
                return original_client(**options)

            with self.subTest(status=status), patch("atena.gemini.genai.Client", side_effect=mock_client):
                with (
                    patch("atena.gemini.time") as clock,
                    self.assertLogs("atena.gemini", level="WARNING") as logs,
                    self.assertRaises(HTTPException) as error,
                ):
                    clock.monotonic.side_effect = [10.0, 10.125]
                    request_drafts("private-notes", 5, "test-key", MODEL)
                self.assertEqual((error.exception.status_code, error.exception.detail), (502, "generation_unavailable"))
                self.assertEqual([record.getMessage() for record in logs.records], [
                    f"Gemini API error: http_status=403 provider_status={expected_status} model={MODEL} elapsed_ms=125",
                ])
                self.assertIsNone(logs.records[0].exc_info)


@unittest.skipUnless(TEST_DATABASE, "Set ATENA_TEST_DATABASE_URL to a migrated test database")
class FlashcardGenerationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        settings = patch.dict(os.environ, {
            "DATABASE_URL": TEST_DATABASE,
            "SESSION_SECRET": "integration-only-secret-at-least-32-bytes",
            "ALLOWED_ORIGINS": "https://atena.example.test",
            "GEMINI_API_KEY": "integration-only-key",
            "GEMINI_MODEL": MODEL,
        })
        settings.start()
        cls.addClassCleanup(settings.stop)
        from atena.main import app

        cls.client_type = TestClient
        cls.app = app

    def setUp(self):
        self.client = self.enterContext(self.client_type(self.app))
        self.owner = self.register()
        self.other = self.register()
        subject = self.client.post("/library/subjects", headers=self.owner, json={"id": "redes", "name": "Redes"})
        self.assertEqual(subject.status_code, 201, subject.text)
        topic = self.client.post("/library/topics", headers=self.owner, json={
            "id": "topologias", "name": "Topologías", "subjectId": "redes",
        })
        self.assertEqual(topic.status_code, 201, topic.text)
        self.draft_path = "/library/topics/topologias/flashcard-drafts"
        self.save_path = "/library/topics/topologias/flashcards"

    def register(self):
        response = self.client.post("/auth/register", json={
            "email": f"{uuid4()}@example.test", "password": "password-de-prueba-123",
        })
        self.assertEqual(response.status_code, 201, response.text)
        return {"Authorization": f"Bearer {response.json()['token']}"}

    def generate(self, **body):
        return self.client.post(self.draft_path, headers=self.owner, json={"notes": NOTES, **body})

    def test_ownership_selective_atomic_save_and_retry(self):
        with patch("atena.flashcards.request_drafts", return_value=json.dumps({"drafts": [STAR, BUS]})) as provider:
            self.assertEqual(self.client.post(self.draft_path, json={"notes": NOTES}).status_code, 401)
            forbidden = self.client.post(self.draft_path, headers=self.other, json={"notes": NOTES})
            self.assertEqual(forbidden.status_code, 404)
            provider.assert_not_called()
            result = self.generate()
            self.assertEqual(result.json(), {"drafts": [STAR, BUS]})
            provider.assert_called_once_with(NOTES, 5, "integration-only-key", MODEL)
        library = lambda: self.client.get("/library", headers=self.owner).json()["reviews"]
        self.assertEqual(library(), [])
        selected = {"id": "tarjeta-aprobada", "question": STAR["question"], "answer": "Un conmutador central."}
        self.assertEqual(self.client.post(self.save_path, headers=self.other, json={"cards": [selected]}).status_code, 404)
        for _ in range(2):
            saved = self.client.post(self.save_path, headers=self.owner, json={"cards": [selected]})
            self.assertEqual(saved.status_code, 201, saved.text)
        self.assertEqual(library(), [{**selected, "topicId": "topologias", "type": "flashcard"}])
        conflict = self.client.post(self.save_path, headers=self.owner, json={"cards": [
            {**selected, "id": "no-se-guarda"}, {**selected, "answer": "Conflicto"},
        ]})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(len(library()), 1)

    def test_invalid_output_timeout_and_manual_creation(self):
        from fastapi import HTTPException

        with patch("atena.flashcards.request_drafts", side_effect=HTTPException(504, "generation_timeout")) as provider:
            self.assertEqual(self.generate(count=11).status_code, 422)
            self.assertEqual(self.generate(notes="x" * 12001).status_code, 422)
            provider.assert_not_called()
            result = self.generate()
            self.assertEqual(result.status_code, 504)
            self.assertEqual(result.json()["detail"], "generation_timeout")
        for invalid in ["{", json.dumps({"drafts": [{**STAR, "source": "Inventado."}]})]:
            with patch("atena.flashcards.request_drafts", return_value=invalid):
                result = self.generate()
                self.assertEqual(result.status_code, 502)
                self.assertEqual(result.json()["detail"], "generation_invalid")
        with patch("atena.flashcards.request_drafts", return_value='{"drafts":[]}'):
            self.assertEqual(self.generate().json(), {"drafts": []})
        created = self.client.post("/library/reviews", headers=self.owner, json={
            "id": "manual", "topicId": "topologias", "type": "flashcard",
            "question": "¿Qué usa una estrella?", "answer": "Un conmutador.",
        })
        self.assertEqual(created.status_code, 201, created.text)

    def test_rate_limit_is_per_account(self):
        with patch("atena.flashcards.request_drafts", return_value='{"drafts":[]}') as provider:
            for _ in range(5):
                self.assertEqual(self.generate().status_code, 200)
            result = self.generate()
            self.assertEqual(result.status_code, 429)
            self.assertEqual(result.json()["detail"], "generation_limit")
            self.assertEqual(provider.call_count, 5)
            self.client.post("/library/subjects", headers=self.other, json={"id": "redes", "name": "Redes"})
            self.client.post("/library/topics", headers=self.other, json={
                "id": "topologias", "name": "Topologías", "subjectId": "redes",
            })
            self.assertEqual(self.client.post(self.draft_path, headers=self.other, json={"notes": NOTES}).status_code, 200)
            self.assertEqual(provider.call_count, 6)
