#include "AtenaSync.h"
#include "AtenaRootCa.h"

#include <HTTPClient.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <sys/time.h>

namespace {
constexpr const char* api = "https://atena-api.onrender.com";
constexpr size_t maxApiResponse = 4096;
constexpr unsigned batchSize = 16;

class LimitedSink : public Stream {
 public:
  LimitedSink(File* file, String* output, size_t maximum)
      : file(file), output(output), maximum(maximum), started(millis()) {}

  size_t count = 0;
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  size_t write(uint8_t byte) override { return write(&byte, 1); }

  size_t write(const uint8_t* data, size_t length) override {
    if (length > maximum - count || millis() - started > 45000) return 0;
    size_t written = 0;
    if (file) written = file->write(data, length);
    else if (output->concat(reinterpret_cast<const char*>(data), length)) written = length;
    count += written;
    return written;
  }

 private:
  File* file;
  String* output;
  size_t maximum;
  uint32_t started;
};

bool openRequest(HTTPClient& http, WiFiClientSecure& client, const String& path, const String& token) {
  client.setCACert(atenaRootCa);
  client.setHandshakeTimeout(12);
  http.setConnectTimeout(12000);
  http.setTimeout(12000);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if (!http.begin(client, String(api) + path)) return false;
  http.addHeader("Accept-Encoding", "identity");
  if (token.length()) http.addHeader("Authorization", "Bearer " + token);
  return true;
}

bool validHash(const String& hash) {
  if (hash.length() != 64) return false;
  for (char ch : hash) if (!(ch >= '0' && ch <= '9') && !(ch >= 'a' && ch <= 'f')) return false;
  return true;
}

bool tokenWithPrefix(const String& token, const char* prefix) {
  return token.length() > 4 && token.length() <= 128 && token.startsWith(prefix);
}
}  // namespace

void AtenaSync::begin() {
  configured = settings.begin("atena", false);
  if (storage.mount() && configured && !settings.getBool("fsReady")) settings.putBool("fsReady", true);
  if (!configured) return;
  JsonDocument doc;
  if (deserializeJson(doc, settings.getString("device"))) return;
  const String id = doc["id"] | "";
  const String credential = doc["token"] | "";
  if (id.length() == 36 && tokenWithPrefix(credential, "atd_")) {
    deviceId = id;
    token = credential;
    loadPomodoros();
  }
}

bool AtenaSync::configureNetwork(const char* json) {
  if (!configured) return false;
  JsonDocument doc;
  if (deserializeJson(doc, json) || !doc["ssid"].is<const char*>() || !doc["password"].is<const char*>()) return false;
  const String ssid = doc["ssid"].as<const char*>();
  const String password = doc["password"].as<const char*>();
  if (!ssid.length() || ssid.length() > 32 ||
      (password.length() && (password.length() < 8 || password.length() > 63))) return false;
  doc.clear();
  doc["ssid"] = ssid;
  doc["password"] = password;
  String network;
  if (doc.overflowed() || !serializeJson(doc, network)) return false;
  return settings.putString("network", network) != 0;
}

bool AtenaSync::initializeStorage() {
  return configured && !storage.ready() && !settings.getBool("fsReady") &&
         storage.initialize() && settings.putBool("fsReady", true) > 0;
}

bool AtenaSync::setTimezoneOffset(int minutes) {
  return configured && settings.putInt("utcOffset", minutes) > 0;
}

bool AtenaSync::connectWiFi() {
  JsonDocument doc;
  if (!configured || deserializeJson(doc, settings.getString("network"))) return false;
  const char* ssid = doc["ssid"] | "";
  const char* password = doc["password"] | "";
  if (!ssid[0]) return false;
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 12000) delay(100);
  return WiFi.status() == WL_CONNECTED;
}

int AtenaSync::jsonRequest(const char* method, const String& path, const String& auth, const String& body,
                           JsonDocument& output) {
  WiFiClientSecure client;
  HTTPClient http;
  if (!openRequest(http, client, path, auth)) return -1;
  if (body.length()) http.addHeader("Content-Type", "application/json");
  const int status = strcmp(method, "GET") == 0 ? http.GET() : http.POST(body);
  if (status != 200 && status != 201 && status != 202) return status;
  const int length = http.getSize();
  if (length > static_cast<int>(maxApiResponse)) return -1;
  String response;
  LimitedSink sink(nullptr, &response, maxApiResponse);
  if (http.writeToStream(&sink) < 0 || (length >= 0 && sink.count != static_cast<size_t>(length)) ||
      deserializeJson(output, response)) return -1;
  return status;
}

void AtenaSync::cancel() {
  code = "";
  pairingId = "";
  pollToken = "";
  if (WiFi.getMode() != WIFI_OFF) WiFi.mode(WIFI_OFF);
}

const char* AtenaSync::finish(const char* message) {
  cancel();
  return message;
}

const char* AtenaSync::start(time_t utc) {
  if (!storage.ready()) return "LittleFS no disponible. Revisa la consola USB.";
  if (!configured || !settings.isKey("network")) return "Configura Wi-Fi por USB.";
  if (utc <= 0) return "Ajusta el reloj por USB para verificar HTTPS.";
  const timeval timestamp{utc, 0};
  if (settimeofday(&timestamp, nullptr) != 0) return "No se pudo ajustar el reloj HTTPS.";
  if (!connectWiFi()) return finish("Sin Wi-Fi. Puedes usar el contenido guardado.");
  if (token.length()) return finish(synchronize());
  const char* error = startPairing();
  return error ? finish(error) : nullptr;
}

const char* AtenaSync::startPairing() {
  JsonDocument response;
  const int status = jsonRequest("POST", "/devices/pairings", "", "{\"name\":\"Atena ESP32\"}", response);
  if (status == 429) return "Límite de vinculación. Inténtalo más tarde.";
  if (status != 201) return "No se pudo iniciar la vinculación HTTPS.";
  const String id = response["pairingId"] | "";
  const String secret = response["pollToken"] | "";
  const String presented = response["code"] | "";
  if (id.length() != 36 || !tokenWithPrefix(secret, "atp_") || presented.length() != 8) {
    return "Respuesta de vinculación inválida.";
  }
  pairingId = id;
  pollToken = secret;
  code = presented;
  const uint32_t now = millis();
  pollInterval = constrain(response["pollIntervalSeconds"] | 5U, 5U, 60U) * 1000;
  nextPoll = now + pollInterval;
  pairingDeadline = now + 600000;
  return nullptr;
}

const char* AtenaSync::poll(uint32_t now) {
  if (code.isEmpty()) return nullptr;
  if (static_cast<int32_t>(now - pairingDeadline) >= 0) return finish("El código de vinculación caducó.");
  if (WiFi.status() != WL_CONNECTED) return finish("Se perdió el Wi-Fi durante la vinculación.");
  if (static_cast<int32_t>(now - nextPoll) < 0) return nullptr;
  JsonDocument response;
  const int status = jsonRequest("POST", "/devices/pairings/" + pairingId + "/credential", pollToken, "", response);
  nextPoll = millis() + pollInterval;
  if (status == 202 || status < 0 || status == 503) return nullptr;
  if (status != 200) return finish("Código caducado. Inicia otra vinculación.");
  const String id = response["deviceId"] | "";
  const String credential = response["deviceToken"] | "";
  if (id != pairingId || !tokenWithPrefix(credential, "atd_")) return finish("Credencial de equipo inválida.");

  JsonDocument record;
  record["id"] = id;
  record["token"] = credential;
  String stored;
  serializeJson(record, stored);
  if (!settings.putString("device", stored)) return finish("No se pudo guardar la vinculación.");
  deviceId = id;
  token = credential;
  loadPomodoros();
  return finish("Equipo vinculado. Elige Sincronizar para descargar tu contenido.");
}

bool AtenaSync::download(uint32_t version, uint32_t bytes) {
  WiFiClientSecure client;
  HTTPClient http;
  const String path = "/devices/sync/decks/" + String(version);
  if (!openRequest(http, client, path, token) || http.GET() != 200) return false;
  const int length = http.getSize();
  if (length >= 0 && static_cast<uint32_t>(length) != bytes) return false;
  File file = LittleFS.open(AtenaStorage::downloadPath, FILE_WRITE);
  if (!file) return false;
  LimitedSink sink(&file, nullptr, bytes);
  const int written = http.writeToStream(&sink);
  file.flush();
  file.close();
  return written >= 0 && sink.count == bytes;
}

bool AtenaSync::confirm(const AtenaStorage::Deck& deck) {
  JsonDocument payload, response;
  payload["sha256"] = deck.sha;
  String request;
  serializeJson(payload, request);
  return jsonRequest("POST", "/devices/sync/decks/" + String(deck.version) + "/confirm",
                     token, request, response) == 200 &&
         (response["version"] | 0UL) == deck.version;
}

bool AtenaSync::sendEvents() {
  for (;;) {
    JsonDocument payload;
    JsonArray batch = payload["events"].to<JsonArray>();
    String paths[batchSize];
    File dir = LittleFS.open("/events");
    if (!dir || !dir.isDirectory()) return false;
    for (File file = dir.openNextFile(); file && batch.size() < batchSize; file = dir.openNextFile()) {
      JsonDocument entry;
      if (file.isDirectory() || file.size() > 512 || deserializeJson(entry, file)) return false;
      if (deviceId != (entry["deviceId"] | "")) continue;
      paths[batch.size()] = file.path();
      entry.remove("deviceId");
      if (!batch.add(entry.as<JsonVariantConst>())) return false;
    }
    dir.close();
    const size_t count = batch.size();
    if (!count) return true;

    String request;
    if (payload.overflowed() || !serializeJson(payload, request)) return false;
    JsonDocument response;
    if (jsonRequest("POST", "/devices/sync/events", token, request, response) != 200) return false;
    const int accepted = response["accepted"] | -1;
    const int duplicates = response["duplicates"] | -1;
    if (accepted < 0 || duplicates < 0 || accepted > static_cast<int>(count) ||
        duplicates != static_cast<int>(count) - accepted) return false;
    for (size_t i = 0; i < count; ++i) if (!LittleFS.remove(paths[i])) return false;
  }
}

void AtenaSync::loadPomodoros() {
  pomodoros = {};
  SavedPomodoros previous{};
  if (settings.getBytesLength("pomodorosV1") != sizeof(previous) ||
      settings.getBytes("pomodorosV1", &previous, sizeof(previous)) != sizeof(previous) ||
      previous.device[36] != '\0' || deviceId != previous.device || previous.count > maxPomodoros) return;
  for (size_t i = 0; i < previous.count; ++i) {
    const auto minutes = previous.entries[i];
    if (!minutes.work || minutes.work > maxMinutes || !minutes.rest || minutes.rest > maxMinutes) return;
  }
  pomodoros = previous;
}

bool AtenaSync::synchronizePomodoros() {
  JsonDocument response;
  if (jsonRequest("GET", "/devices/sync/pomodoros", token, "", response) != 200 ||
      (response["schemaVersion"] | 0) != 1) return false;
  const JsonArrayConst entries = response["pomodoros"].as<JsonArrayConst>();
  if (entries.isNull() || entries.size() > maxPomodoros) return false;

  SavedPomodoros next{};
  deviceId.toCharArray(next.device, sizeof(next.device));
  for (JsonVariantConst entry : entries) {
    if (!entry["workMinutes"].is<uint32_t>() || !entry["breakMinutes"].is<uint32_t>()) return false;
    const uint32_t work = entry["workMinutes"].as<uint32_t>();
    const uint32_t rest = entry["breakMinutes"].as<uint32_t>();
    if (!work || work > maxMinutes || !rest || rest > maxMinutes) return false;
    next.entries[next.count++] = {work, rest};
  }
  if (deviceId == pomodoros.device && next.count == pomodoros.count &&
      memcmp(next.entries, pomodoros.entries, next.count * sizeof(PomodoroMinutes)) == 0) return true;

  // Commit the complete validated list as one NVS value before using it in memory.
  if (settings.putBytes("pomodorosV1", &next, sizeof(next)) != sizeof(next)) return false;
  pomodoros = next;
  return true;
}

const char* AtenaSync::synchronize() {
  JsonDocument manifest;
  const int status = jsonRequest("GET", "/devices/sync/manifest", token, "", manifest);
  if (status == 401) {
    if (!settings.remove("device")) return "No se pudo actualizar la vinculación. Reintenta.";
    token = "";
    deviceId = "";
    pomodoros = {};
    return "Vinculación revocada. Sincroniza para vincular otra vez.";
  }
  if (status != 200) return "API HTTPS no disponible. Puedes usar el contenido guardado.";

  const bool pomodorosSynced = synchronizePomodoros();
  syncMessage = pomodorosSynced ? "Pomodoros listos.\n\n" : "Pomodoros: sin actualizar.\n";
  syncMessage += synchronizeDeck(manifest);
  return syncMessage.c_str();
}

const char* AtenaSync::synchronizeDeck(JsonDocument& manifest) {
  const auto& current = storage.current();
  const auto confirmed = manifest["confirmed"]["version"] | 0UL;
  if (current.version && current.deviceId == deviceId && confirmed != current.version && !confirm(current)) {
    return "Mazo guardado. Falta confirmar su recepción.";
  }
  const bool eventsSent = sendEvents() && storage.pendingEvents() == 0;
  if (manifest["available"].isNull()) return "Publica un mazo en la web.";
  const uint32_t version = manifest["available"]["version"] | 0UL;
  const uint32_t bytes = manifest["available"]["sizeBytes"] | 0UL;
  const uint32_t count = manifest["available"]["cardCount"] | 0UL;
  const String hash = manifest["available"]["sha256"] | "";
  if (!version || !bytes || bytes > AtenaStorage::maxDeckBytes || !count ||
      count > AtenaStorage::maxCards || !validHash(hash)) return "Manifiesto de mazo inválido.";
  if (current.deviceId == deviceId && version <= current.version) {
    if (version != current.version || hash != current.sha || bytes != current.bytes || count != current.count) {
      return "La versión publicada no coincide con el mazo guardado.";
    }
    return eventsSent ? "Mazo y resultados sincronizados." : "Mazo disponible. Hay resultados pendientes.";
  }
  if (!storage.startDownload(bytes)) return "Espacio insuficiente para descargar. Se conserva el mazo vigente.";
  if (!download(version, bytes) || !storage.install(version, bytes, static_cast<uint16_t>(count), hash, deviceId)) {
    storage.cancelDownload();
    return "Descarga incompleta o inválida. Se conserva el mazo vigente.";
  }
  if (!confirm(storage.current())) return "Mazo guardado. Confírmalo en la próxima sincronización.";
  return eventsSent ? "Mazo sincronizado. Ya puedes estudiar sin Wi-Fi."
                    : "Mazo disponible. Hay resultados pendientes.";
}
