import os
import unittest
from uuid import uuid4


TEST_DATABASE = os.getenv("ATENA_TEST_DATABASE_URL")
ALLOWED_ORIGIN = "https://atena.example.test"


@unittest.skipUnless(TEST_DATABASE, "Set ATENA_TEST_DATABASE_URL to a migrated test database")
class LibraryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        settings = patch.dict(os.environ, {
            "DATABASE_URL": TEST_DATABASE,
            "SESSION_SECRET": "integration-only-secret-at-least-32-bytes",
            "ALLOWED_ORIGINS": ALLOWED_ORIGIN,
        })
        settings.start()
        cls.addClassCleanup(settings.stop)
        from atena.main import app

        cls.client_type = TestClient
        cls.app = app

    def setUp(self):
        self.client = self.enterContext(self.client_type(self.app))
        self.creds = {"email": f"{uuid4()}@example.test", "password": "password-de-prueba-123"}
        self.owner = self.register(self.creds)
        self.other = self.register({**self.creds, "email": f"{uuid4()}@example.test"})

    def register(self, creds):
        response = self.client.post("/auth/register", json=creds)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        return self.headers(response)

    def headers(self, response):
        return {"Authorization": f"Bearer {response.json()['token']}"}

    def sample_library(self):
        return {
            "subjects": [{"id": "redes", "name": "Redes", "description": ""}],
            "topics": [{"id": "topologias", "name": "Topologías", "subjectId": "redes",
                        "description": "", "category": ""}],
            "reviews": [{"id": "estrella", "type": "flashcard", "topicId": "topologias",
                         "question": "¿Qué conecta los nodos?", "answer": "Un conmutador."}],
        }

    def test_create_reload_second_session_and_isolation(self):
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})
        self.assertEqual(self.client.get("/library").status_code, 401)
        self.assertEqual(self.client.post("/auth/login", json={**self.creds, "password": "incorrecta"}).status_code, 401)
        self.assertEqual(self.client.post("/auth/register", json=self.creds).status_code, 409)

        data = self.sample_library()
        for kind, records in data.items():
            response = self.client.post(f"/library/{kind}", headers=self.owner, json=records[0])
            self.assertEqual(response.status_code, 201, response.text)
        retry = self.client.post("/library/reviews", headers=self.owner, json=data["reviews"][0])
        self.assertEqual(retry.status_code, 201, retry.text)
        self.assertEqual(self.client.get("/library", headers=self.owner).json(), data)

        with self.client_type(self.app) as second_browser:
            response = second_browser.post("/auth/login", json=self.creds)
            self.assertEqual(response.status_code, 200, response.text)
            second = self.headers(response)
            self.assertNotEqual(self.owner, second)
            self.assertEqual(second_browser.get("/library", headers=second).json(), data)
            changed = {**data["reviews"][0], "answer": "Un equipo central."}
            result = second_browser.put("/library/reviews/estrella", headers=second, json=changed)
            self.assertEqual(result.json(), changed)
        self.assertEqual(self.client.get("/library", headers=self.owner).json()["reviews"], [changed])

        self.assertEqual(self.client.get("/library", headers=self.other).json(),
                         {"subjects": [], "topics": [], "reviews": []})
        for kind, records in data.items():
            entry = records[0]
            result = self.client.put(f"/library/{kind}/{entry['id']}", headers=self.other, json=entry)
            self.assertEqual(result.status_code, 404, result.text)
        self.assertEqual(self.client.post("/library/reviews", headers=self.other, json=changed).status_code, 404)
        self.assertEqual(self.client.post("/library/topics", headers=self.other, json=data["topics"][0]).status_code, 404)
        self.assertEqual(self.client.delete("/library/topics/topologias", headers=self.other).status_code, 404)
        self.assertEqual(self.client.delete("/library/reviews/estrella", headers=self.other).status_code, 404)
        self.assertEqual(self.client.get("/library", headers=self.owner).json()["reviews"], [changed])

        self.assertEqual(self.client.post("/auth/logout", headers=self.owner).status_code, 204)
        self.assertEqual(self.client.get("/library", headers=self.owner).status_code, 401)
        self.assertEqual(self.client.get("/library", headers=second).status_code, 200)

    def test_import_retains_ids_edits_and_deletions(self):
        source = self.sample_library()
        source["reviews"].append({
            "id": "recuerdo", "topicId": "topologias", "type": "recall", "name": "Describe la red", "question": "Explica.",
        })
        source["reviews"].append({
            "id": "opciones", "topicId": "topologias", "type": "choice", "name": "Tipos", "question": "¿Cuál?",
            "options": ["Estrella", "Bus", "Malla"], "correct": 0, "explanation": "",
        })
        imported = self.client.post("/library/import", headers=self.owner, json=source)
        self.assertEqual(imported.status_code, 200, imported.text)
        self.assertEqual(imported.json(), {"library": source, "added": 5, "skipped": 0})

        changed = {**source["subjects"][0], "name": "Redes actualizadas"}
        self.assertEqual(self.client.put("/library/subjects/redes", headers=self.owner, json=changed).status_code, 200)
        self.assertEqual(self.client.delete("/library/reviews/estrella", headers=self.owner).status_code, 204)
        self.assertEqual(self.client.post("/library/reviews", headers=self.owner, json=source["reviews"][0]).status_code, 409)
        repeated = self.client.post("/library/import", headers=self.owner, json=source).json()
        self.assertEqual(repeated["added"], 0)
        self.assertEqual(repeated["skipped"], 5)
        self.assertEqual(repeated["library"]["subjects"], [changed])
        self.assertEqual(repeated["library"]["reviews"], source["reviews"][1:])

        other_import = self.client.post("/library/import", headers=self.other, json=source)
        self.assertEqual(other_import.json()["library"], source)
        self.assertEqual(self.client.delete("/library/topics/topologias", headers=self.owner).status_code, 204)
        self.assertEqual(self.client.get("/library", headers=self.owner).json()["reviews"], [])
        repeated = self.client.post("/library/import", headers=self.owner, json=source).json()
        self.assertEqual(repeated["library"]["topics"], [])
        self.assertEqual(self.client.get("/library", headers=self.other).json(), source)

    def test_cors_and_invalid_import(self):
        for origin, allowed in [(ALLOWED_ORIGIN, True), ("https://elsewhere.example.test", False)]:
            response = self.client.options("/library", headers={
                "Origin": origin, "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "Authorization",
            })
            self.assertEqual(response.headers.get("access-control-allow-origin"), origin if allowed else None)

        broken = self.sample_library()
        broken["reviews"][0]["answer"] = " "
        response = self.client.post("/library/import", headers=self.owner, json=broken)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.get("/library", headers=self.owner).json()["subjects"], [])
        login = self.client.post("/auth/login", json={"email": "bad", "password": "value-to-redact"})
        self.assertEqual(login.status_code, 422)
        self.assertNotIn("value-to-redact", login.text)
