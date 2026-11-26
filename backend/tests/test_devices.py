import hashlib
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4
from zoneinfo import ZoneInfo


TEST_DATABASE = os.getenv("ATENA_TEST_DATABASE_URL")


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


class Esp32:
    def __init__(self, client, name):
        self.client = client
        response = client.post("/devices/pairings", json={"name": name})
        response.raise_for_status()
        self.pairing = response.json()

    def claim(self, account_headers):
        return self.client.post("/devices/pairings/claim", headers=account_headers, json={"code": self.pairing["code"]})

    def collect(self, token=None):
        return self.client.post(f"/devices/pairings/{self.pairing['pairingId']}/credential",
                                headers=bearer(token or self.pairing["pollToken"]))

    def connect(self):
        response = self.collect()
        response.raise_for_status()
        self.headers = bearer(response.json()["deviceToken"])
        return response.json()

    def manifest(self):
        return self.client.get("/devices/sync/manifest", headers=self.headers)

    def download(self, version):
        return self.client.get(f"/devices/sync/decks/{version}", headers=self.headers)

    def confirm(self, version, checksum):
        return self.client.post(f"/devices/sync/decks/{version}/confirm", headers=self.headers,
                                json={"sha256": checksum})

    def upload(self, events):
        return self.client.post("/devices/sync/events", headers=self.headers, json={"events": events})


@unittest.skipUnless(TEST_DATABASE, "Set ATENA_TEST_DATABASE_URL to a migrated test database")
class DeviceSyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        settings = patch.dict(os.environ, {
            "DATABASE_URL": TEST_DATABASE,
            "SESSION_SECRET": "integration-only-secret-at-least-32-bytes",
            "ALLOWED_ORIGINS": "https://atena.example.test",
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

    def register(self):
        response = self.client.post("/auth/register", json={
            "email": f"{uuid4()}@example.test", "password": "password-de-prueba-123",
        })
        self.assertEqual(response.status_code, 201, response.text)
        return bearer(response.json()["token"])

    def create_topic(self, headers, topic_id):
        subject = self.client.post("/library/subjects", headers=headers, json={"id": "redes", "name": "Redes"})
        self.assertEqual(subject.status_code, 201, subject.text)
        topic = self.client.post("/library/topics", headers=headers, json={
            "id": topic_id, "name": "Topologías", "subjectId": "redes",
        })
        self.assertEqual(topic.status_code, 201, topic.text)

    def web_devices(self, headers):
        return self.client.get("/devices", headers=headers).json()["devices"]

    def publish(self, device_id, topic_id, headers=None):
        return self.client.post(f"/devices/{device_id}/decks", headers=headers or self.owner, json={"topicId": topic_id})

    def test_pomodoro_crud_and_complete_device_snapshot(self):
        path = "/pomodoros"
        sync = "/devices/sync/pomodoros"
        short = {"workMinutes": 1, "breakMinutes": 1}
        regular = {"workMinutes": 25, "breakMinutes": 5}
        origin = "https://atena.example.test"
        for endpoint, method in ((path, "POST"), (f"{path}/1", "PUT"), (f"{path}/1", "DELETE")):
            preflight = self.client.options(endpoint, headers={
                "Origin": origin,
                "Access-Control-Request-Method": method,
                "Access-Control-Request-Headers": "authorization,content-type",
            })
            self.assertEqual(preflight.status_code, 200)
            self.assertEqual(preflight.headers["Access-Control-Allow-Origin"], origin)
            self.assertIn(method, preflight.headers["Access-Control-Allow-Methods"])
        self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.get(sync, headers=self.owner).status_code, 401)
        for invalid in (0, -1, 1.5, 1.0, True, "1", 2_147_483_648):
            result = self.client.post(path, headers=self.owner, json={**short, "workMinutes": invalid})
            self.assertEqual(result.status_code, 422)
        self.assertEqual(self.client.post(path, headers=self.owner, json={"workMinutes": 1}).status_code, 422)

        esp = Esp32(self.client, "Atena Pomodoros")
        other = Esp32(self.client, "Atena de otra cuenta")
        for unit, account in ((esp, self.owner), (other, self.other)):
            self.assertEqual(unit.claim(account).status_code, 201)
            unit.connect()
        self.assertEqual(self.client.get(path, headers=esp.headers).status_code, 401)
        self.assertEqual(self.client.get(sync, headers=esp.headers).json(), {"schemaVersion": 1, "pomodoros": []})

        ids = []
        for minutes in (short, regular):
            created = self.client.post(path, headers=self.owner, json=minutes)
            self.assertEqual(created.status_code, 201, created.text)
            ids.append(created.json()["id"])
        account_list = self.client.get(path, headers={**self.owner, "Origin": origin})
        self.assertEqual(account_list.headers["Access-Control-Allow-Origin"], origin)
        self.assertEqual(account_list.json()["pomodoros"],
                         [{"id": ids[0], **short}, {"id": ids[1], **regular}])
        snapshot = self.client.get(sync, headers=esp.headers)
        self.assertEqual(snapshot.json(), {"schemaVersion": 1, "pomodoros": [short, regular]})
        self.assertEqual(snapshot.headers["Cache-Control"], "no-store")
        self.assertEqual(self.client.get(sync, headers=other.headers).json()["pomodoros"], [])

        first, second = (f"{path}/{entry}" for entry in ids)
        changed = {"workMinutes": 1, "breakMinutes": 2}
        self.assertEqual(self.client.put(first, headers=self.other, json=changed).status_code, 404)
        self.assertEqual(self.client.delete(second, headers=self.other).status_code, 404)
        self.assertEqual(self.client.put(first, headers=self.owner, json=changed).json(), {"id": ids[0], **changed})
        self.assertEqual(self.client.delete(second, headers=self.owner).status_code, 204)
        self.assertEqual(self.client.get(sync, headers=esp.headers).json()["pomodoros"], [changed])
        self.assertEqual(self.client.delete(first, headers=self.owner).status_code, 204)
        self.assertEqual(self.client.get(sync, headers=esp.headers).json()["pomodoros"], [])

    def test_spaced_agenda_preview_results_edit_and_cancel(self):
        self.create_topic(self.owner, "topologias")
        esp = Esp32(self.client, "Atena Agenda")
        device = esp.claim(self.owner).json()["id"]
        esp.connect()
        path = "/spaced-plans"
        sync = "/devices/sync/agenda"
        zone = ZoneInfo("America/Mexico_City")
        now = datetime.now(zone)
        first = (now + timedelta(minutes=6)).replace(second=0, microsecond=0)
        second = first + timedelta(days=1)
        clock = lambda value: {"date": value.date().isoformat(), "time": value.strftime("%H:%M")}
        payload = {"topicId": "topologias", "deviceId": device, "startDate": now.date().isoformat(),
                   "examDate": (second + timedelta(days=3)).date().isoformat(), "timeZone": zone.key,
                   "time": first.strftime("%H:%M"), "minutes": 1, "reason": "Examen de redes",
                   "sessions": [clock(first), clock(second)]}
        self.assertEqual(self.client.get(sync, headers=self.owner).status_code, 401)
        self.assertEqual(self.client.get(path, headers=esp.headers).status_code, 401)
        preview = self.client.post(path + "/preview", headers=self.owner, json=payload)
        self.assertEqual(preview.status_code, 200, preview.text)
        self.assertEqual(preview.json()["sessions"][0]["date"], first.date().isoformat())
        created = self.client.post(path, headers=self.owner, json=payload)
        self.assertEqual(created.status_code, 201, created.text)
        plan = created.json()["id"]
        self.assertEqual(self.client.delete(f"{path}/{plan}", headers=self.other).status_code, 404)

        def web_plans():
            return self.client.get(path, headers=self.owner).json()["plans"]

        def agenda():
            response = self.client.get(sync, headers=esp.headers)
            self.assertEqual(response.status_code, 200, response.text)
            return response.json()

        def confirm(revision):
            return self.client.post(sync + "/confirm", headers=esp.headers, json={"revision": revision})

        self.assertTrue(web_plans()[0]["pendingSync"])
        conflict = self.client.post(path + "/preview", headers=self.owner, json=payload)
        self.assertEqual(conflict.status_code, 422)
        self.assertEqual(conflict.json()["detail"]["issues"][0]["field"], "sessions.0")
        first_snapshot = agenda()
        self.assertEqual(first_snapshot, agenda())
        self.assertEqual(first_snapshot["sessions"][0]["start"], int(first.timestamp()))
        self.assertEqual(first_snapshot["sessions"][0]["minutes"], 1)
        self.assertEqual(confirm(first_snapshot["revision"] + 1).status_code, 409)
        self.assertEqual(confirm(first_snapshot["revision"]).status_code, 200)
        self.assertFalse(web_plans()[0]["pendingSync"])

        result = {"id": first_snapshot["sessions"][0]["id"], "status": "completed",
                  "finishedAt": (first + timedelta(minutes=1)).isoformat()}
        for _ in range(2):
            response = self.client.post(sync + "/results", headers=esp.headers, json={"results": [result]})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["acknowledged"], [result["id"]])
        self.assertEqual(len(agenda()["sessions"]), 1)

        moved = second + timedelta(days=1, hours=1)
        edit = self.client.put(f"{path}/{plan}", headers=self.owner, json={
            **payload, "reason": "Nuevo motivo", "sessions": [clock(moved)],
        })
        self.assertEqual(edit.status_code, 200, edit.text)
        snapshot = agenda()
        self.assertGreater(snapshot["revision"], first_snapshot["revision"])
        self.assertEqual([(s["start"], s["minutes"]) for s in snapshot["sessions"]], [(int(moved.timestamp()), 1)])
        history = web_plans()[0]["sessions"]
        self.assertEqual([s["status"] for s in history], ["completed", "scheduled"])
        self.assertEqual(history[0]["reason"], payload["reason"])
        self.assertEqual(self.client.delete(f"{path}/{plan}", headers=self.owner).status_code, 204)
        self.assertEqual(agenda()["sessions"], [])
        self.assertTrue(web_plans()[0]["pendingSync"])
        self.assertEqual(confirm(agenda()["revision"]).status_code, 200)
        self.assertFalse(web_plans()[0]["pendingSync"])
        self.assertEqual([s["status"] for s in web_plans()[0]["sessions"]], ["completed"])
        replacement = self.client.post(path, headers=self.owner, json={**payload, "sessions": [clock(moved)]})
        self.assertEqual(replacement.status_code, 201, replacement.text)
        skip = {"id": agenda()["sessions"][0]["id"], "status": "skipped", "finishedAt": moved.isoformat()}
        response = self.client.post(sync + "/results", headers=esp.headers, json={"results": [skip]})
        self.assertEqual(response.json()["acknowledged"], [skip["id"]])
        self.assertEqual(agenda()["sessions"], [])
        self.assertIn("skipped", [s["status"] for p in web_plans() for s in p["sessions"]])

    def test_esp32_pair_publish_verify_confirm_and_retry_events(self):
        self.create_topic(self.owner, "topologias")
        self.create_topic(self.other, "solo-ajeno")
        manual = {"id": "manual", "topicId": "topologias", "type": "flashcard",
                  "question": "¿Qué equipo conecta los nodos?", "answer": "Un conmutador 🛜."}
        self.assertEqual(self.client.post("/library/reviews", headers=self.owner, json=manual).status_code, 201)
        approved = self.client.post("/library/topics/topologias/flashcards", headers=self.owner, json={"cards": [{
            "id": "gema", "question": "¿En qué topología hay un nodo central?", "answer": "En estrella.",
        }]})
        self.assertEqual(approved.status_code, 201, approved.text)

        esp = Esp32(self.client, "Atena de bolsillo")
        alien = Esp32(self.client, "Otro dispositivo")
        pending = esp.collect()
        self.assertEqual(pending.status_code, 202)
        self.assertEqual(pending.headers["Retry-After"], "5")
        self.assertEqual(esp.collect(alien.pairing["pollToken"]).status_code, 404)
        self.assertEqual(esp.claim({}).status_code, 401)
        claimed = esp.claim(self.owner)
        self.assertEqual(claimed.status_code, 201, claimed.text)
        device_id = claimed.json()["id"]
        self.assertNotIn("deviceToken", claimed.json())
        self.assertEqual(esp.claim(self.other).status_code, 404)
        self.assertEqual(esp.collect(alien.pairing["pollToken"]).status_code, 404)
        credential = esp.connect()
        self.assertEqual(esp.collect().json(), credential)
        self.assertEqual(esp.manifest().json(), {"available": None, "confirmed": None})
        self.assertEqual(self.client.get("/devices/sync/manifest", headers=self.owner).status_code, 401)
        self.assertEqual(self.client.get("/devices", headers=esp.headers).status_code, 401)
        self.assertEqual(self.web_devices(self.other), [])

        self.assertEqual(alien.claim(self.other).status_code, 201)
        alien.connect()
        other_same_owner = Esp32(self.client, "Otro Atena de la cuenta")
        self.assertEqual(other_same_owner.claim(self.owner).status_code, 201)
        other_same_owner.connect()
        self.assertEqual(self.publish(device_id, "topologias", self.other).status_code, 404)
        self.assertEqual(self.publish(device_id, "solo-ajeno").status_code, 404)

        result = self.publish(device_id, "topologias")
        self.assertEqual(result.status_code, 201, result.text)
        first = result.json()
        self.assertEqual(first["version"], 1)
        self.assertEqual(first["cardCount"], 2)
        self.assertEqual(esp.manifest().json()["available"]["version"], 1)
        self.assertEqual(alien.download(1).status_code, 404)
        self.assertEqual(other_same_owner.download(1).status_code, 404)
        download = esp.download(1)
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.headers["Cache-Control"], "no-store, no-transform")
        self.assertEqual(download.headers["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(int(download.headers["Content-Length"]), len(download.content))
        self.assertEqual(first["sizeBytes"], len(download.content))
        self.assertEqual(hashlib.sha256(download.content).hexdigest(), first["sha256"])
        self.assertIn("conmutador 🛜".encode("utf-8"), download.content)
        deck = download.json()
        self.assertEqual(deck["schemaVersion"], 1)
        self.assertEqual((deck["subject"]["id"], deck["topic"]["id"]), ("redes", "topologias"))
        self.assertEqual([card["id"] for card in deck["cards"]], ["manual", "gema"])
        self.assertEqual(esp.confirm(1, "0" * 64).status_code, 409)

        changed = self.client.put("/library/reviews/manual", headers=self.owner, json={**manual, "answer": "Respuesta nueva."})
        self.assertEqual(changed.status_code, 200, changed.text)
        second = self.publish(device_id, "topologias").json()
        self.assertEqual(second["version"], 2)
        self.assertEqual(esp.download(1).content, download.content)
        self.assertNotEqual(second["sha256"], first["sha256"])
        receipt = esp.confirm(1, first["sha256"])
        self.assertEqual(receipt.status_code, 200, receipt.text)
        states = {device["id"]: device for device in self.web_devices(self.owner)}
        self.assertEqual(states[device_id]["published"]["version"], 2)
        self.assertEqual(states[device_id]["confirmed"]["version"], 1)
        self.assertIsNone(states[other_same_owner.pairing["pairingId"]]["confirmed"])
        self.assertEqual(esp.confirm(2, second["sha256"]).status_code, 200)
        self.assertEqual(esp.confirm(1, first["sha256"]).json(), receipt.json())
        self.assertEqual(esp.manifest().json()["confirmed"]["version"], 2)

        first_event = {"id": str(uuid4()), "cardId": "manual", "deckVersion": 1, "rating": "remembered",
                       "studiedAt": datetime.now(timezone.utc).isoformat()}
        second_event = {**first_event, "id": str(uuid4()), "rating": "review"}
        self.assertEqual(alien.upload([first_event]).status_code, 422)
        rejected = esp.upload([first_event, {**second_event, "cardId": "ajena"}])
        self.assertEqual(rejected.status_code, 422)
        self.assertEqual(self.client.get("/devices/activity", headers=self.owner).json()["events"], [])
        self.assertEqual(esp.upload([first_event, second_event]).json(), {"accepted": 2, "duplicates": 0})
        self.assertEqual(esp.upload([first_event]).json(), {"accepted": 0, "duplicates": 1})
        self.assertEqual(esp.upload([{**first_event, "rating": "review"}]).status_code, 409)
        feed = self.client.get("/devices/activity", headers=self.owner).json()
        self.assertEqual([entry["id"] for entry in feed["events"]], [first_event["id"], second_event["id"]])
        self.assertEqual(feed["events"][0]["question"], manual["question"])
        self.assertEqual(self.client.get("/devices/activity", headers=self.other).json()["events"], [])
        self.assertEqual(self.client.get("/devices/activity", params={"after": feed["nextCursor"]},
                                         headers=self.owner).json()["events"], [])

        self.assertEqual(self.client.delete(f"/devices/{device_id}", headers=self.other).status_code, 404)
        self.assertEqual(self.client.delete(f"/devices/{device_id}", headers=self.owner).status_code, 204)
        self.assertEqual(esp.manifest().status_code, 401)
        self.assertEqual(esp.upload([first_event]).status_code, 401)
        self.assertEqual(esp.collect().status_code, 404)
        self.assertEqual(len(self.client.get("/devices/activity", headers=self.owner).json()["events"]), 2)

    def test_expired_code_claim_limit_and_empty_topic(self):
        from atena.config import connection

        esp = Esp32(self.client, "Atena vencido")
        with connection() as db:
            db.execute("UPDATE device_pairings SET expires_at = now() - interval '1 second' WHERE id = %s",
                       (esp.pairing["pairingId"],))
        for _ in range(8):
            self.assertEqual(esp.claim(self.owner).status_code, 404)
        self.assertEqual(esp.claim(self.owner).status_code, 429)
        self.assertEqual(esp.collect().status_code, 404)

        fresh = Esp32(self.client, "Atena disponible")
        self.assertEqual(fresh.claim(self.other).status_code, 201)
        self.create_topic(self.other, "vacio")
        response = self.publish(fresh.pairing["pairingId"], "vacio", self.other)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "device_empty_deck")
