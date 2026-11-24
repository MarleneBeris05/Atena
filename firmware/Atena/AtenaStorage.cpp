#include "AtenaStorage.h"

#include <ArduinoJson.h>
#include <LittleFS.h>
#include <esp_random.h>
#include <mbedtls/sha256.h>

#include <memory>

namespace {
constexpr const char* decks[] = {"/deck-a.json", "/deck-b.json"};
constexpr const char* metadata[] = {"/deck-a.meta", "/deck-b.meta"};
constexpr const char* metaTemp = "/deck-meta.tmp";
constexpr const char* queueDir = "/events";
constexpr const char* eventTemp = "/event.tmp";

class BufferedFile {
 public:
  explicit BufferedFile(File& file, uint32_t start = 0) : source(file), cursor(start), valid(file.seek(start)) {}
  uint32_t position() const { return cursor; }
  int peek() {
    if (!valid) return -1;
    if (used == filled) {
      filled = source.read(buffer, sizeof(buffer));
      used = 0;
      if (filled == 0 || filled > sizeof(buffer)) {
        valid = false;
        return -1;
      }
    }
    return buffer[used];
  }
  int read() {
    const int byte = peek();
    if (byte >= 0) { ++used; ++cursor; }
    return byte;
  }
  void spaces() {
    while (peek() == ' ' || peek() == '\r' || peek() == '\n' || peek() == '\t') read();
  }
  bool take(char token) {
    spaces();
    if (peek() != token) return false;
    read();
    return true;
  }

 private:
  File& source;
  uint32_t cursor;
  bool valid;
  uint8_t buffer[512];
  size_t used = 0;
  size_t filled = 0;
};

bool readAscii(BufferedFile& input, char* value, size_t capacity, bool openingQuote = true) {
  if (openingQuote && !input.take('"')) return false;
  size_t length = 0;
  uint32_t point;
  for (;;) {
    const auto next = nextJsonCharacter(input, point);
    if (next == TextResult::End) {
      value[length] = '\0';
      return true;
    }
    if (next != TextResult::Character || point < 32 || point > 126 || length + 1 >= capacity) return false;
    value[length++] = static_cast<char>(point);
  }
}

bool skipString(BufferedFile& input) {
  uint32_t point;
  auto next = nextJsonCharacter(input, point);
  while (next == TextResult::Character) next = nextJsonCharacter(input, point);
  return next == TextResult::End;
}

bool unsignedValue(BufferedFile& input, uint32_t& value) {
  input.spaces();
  value = 0;
  if (input.peek() < '0' || input.peek() > '9') return false;
  while (input.peek() >= '0' && input.peek() <= '9') {
    const uint32_t digit = input.read() - '0';
    if (value > (UINT32_MAX - digit) / 10) return false;
    value = value * 10 + digit;
  }
  return true;
}

bool skipValue(BufferedFile& input, uint8_t depth = 0) {
  if (depth > 8) return false;
  if (input.take('"')) return skipString(input);
  const bool object = input.take('{');
  if (object || input.take('[')) {
    const char end = object ? '}' : ']';
    if (input.take(end)) return true;
    do {
      if (object && (!input.take('"') || !skipString(input) || !input.take(':'))) return false;
      if (!skipValue(input, depth + 1)) return false;
    } while (input.take(','));
    return input.take(end);
  }
  bool any = false;
  int byte;
  while ((byte = input.peek()) >= 0 && byte > ' ' && byte != ',' && byte != ']' && byte != '}') {
    any = true;
    input.read();
  }
  return any;
}

bool safeCardId(const char* id) {
  if (!id[0]) return false;
  for (; *id; ++id) {
    if ((*id < '0' || *id > '9') && (*id < 'A' || *id > 'Z') &&
        (*id < 'a' || *id > 'z') && *id != '_' && *id != '-') return false;
  }
  return true;
}

bool removeIfPresent(const char* path) {
  return !LittleFS.exists(path) || LittleFS.remove(path);
}

bool digestMatches(File& file, const AtenaStorage::Deck& info) {
  if (!file || file.size() != info.bytes || !file.seek(0)) return false;
  unsigned char digest[32];
  unsigned char buffer[1024];
  mbedtls_sha256_context context;
  mbedtls_sha256_init(&context);
  bool valid = mbedtls_sha256_starts(&context, 0) == 0;
  uint32_t left = info.bytes;
  while (valid && left) {
    const size_t count = file.read(buffer, min(static_cast<size_t>(left), sizeof(buffer)));
    if (!count) { valid = false; break; }
    valid = mbedtls_sha256_update(&context, buffer, count) == 0;
    left -= count;
    yield();
  }
  if (valid) valid = mbedtls_sha256_finish(&context, digest) == 0;
  mbedtls_sha256_free(&context);
  if (!valid) return false;
  char hex[65];
  for (size_t i = 0; i < sizeof(digest); ++i) snprintf(hex + i * 2, 3, "%02x", digest[i]);
  return info.sha == hex;
}

bool writeJsonFile(const char* path, const JsonDocument& doc, size_t limit) {
  const size_t bytes = measureJson(doc);
  if (!bytes || bytes > limit) return false;
  File file = LittleFS.open(path, FILE_WRITE);
  if (!file) return false;
  const size_t written = serializeJson(doc, file);
  file.flush();
  file.close();
  if (written != bytes) return false;
  File persisted = LittleFS.open(path, FILE_READ);
  return persisted && persisted.size() == bytes;
}

void randomUuid(char (&uuid)[37]) {
  uint8_t bytes[16];
  esp_fill_random(bytes, sizeof(bytes));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  snprintf(uuid, sizeof(uuid),
           "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
           bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]);
}
}  // namespace

bool AtenaStorage::index(File& source, const Deck& info, Card* output) {
  BufferedFile input(source);
  if (!input.take('{')) return false;
  uint32_t schema = 0, version = 0;
  uint16_t count = 0;
  do {
    char key[32];
    if (!readAscii(input, key, sizeof(key)) || !input.take(':')) return false;
    if (strcmp(key, "schemaVersion") == 0) {
      if (!unsignedValue(input, schema)) return false;
    } else if (strcmp(key, "version") == 0) {
      if (!unsignedValue(input, version)) return false;
    } else if (strcmp(key, "cards") == 0) {
      if (count || !input.take('[')) return false;
      do {
        if (count >= info.count || !input.take('{')) return false;
        Card card;
        do {
          if (!readAscii(input, key, sizeof(key)) || !input.take(':')) return false;
          if (strcmp(key, "id") == 0) {
            if (card.id || !input.take('"')) return false;
            card.id = input.position();
            char id[129];
            if (!readAscii(input, id, sizeof(id), false) || !safeCardId(id)) return false;
          } else if (strcmp(key, "question") == 0 || strcmp(key, "answer") == 0) {
            auto& offset = key[0] == 'q' ? card.question : card.answer;
            if (offset || !input.take('"') || input.peek() == '"') return false;
            offset = input.position();
            if (!skipString(input)) return false;
          } else if (!skipValue(input)) return false;
        } while (input.take(','));
        if (!input.take('}') || !card.id || !card.question || !card.answer) return false;
        output[count++] = card;
        yield();
      } while (input.take(','));
      if (!input.take(']')) return false;
    } else if (!skipValue(input)) return false;
  } while (input.take(','));
  if (!input.take('}')) return false;
  input.spaces();
  return input.peek() == -1 && schema == 1 && version == info.version && count == info.count;
}

bool AtenaStorage::readMeta(int candidate, Deck& info) {
  File file = LittleFS.open(metadata[candidate], FILE_READ);
  JsonDocument doc;
  if (!file || file.size() > 512 || deserializeJson(doc, file)) return false;
  info.generation = doc["generation"] | 0UL;
  info.version = doc["version"] | 0UL;
  info.bytes = doc["bytes"] | 0UL;
  const uint32_t count = doc["count"] | 0UL;
  if (!count || count > maxCards) return false;
  info.count = static_cast<uint16_t>(count);
  info.sha = doc["sha"] | "";
  info.deviceId = doc["deviceId"] | "";
  return info.generation && info.version && info.bytes && info.bytes <= maxDeckBytes &&
         info.sha.length() == 64 && info.deviceId.length() == 36;
}

bool AtenaStorage::openSlot(int candidate, const Deck& info) {
  File file = LittleFS.open(decks[candidate], FILE_READ);
  if (!digestMatches(file, info) || !index(file, info, cards)) return false;
  active = info;
  slot = candidate;
  return true;
}

bool AtenaStorage::mount() {
  if (mounted) return true;
  mounted = LittleFS.begin(false);
  if (!mounted) return false;
  removeIfPresent(downloadPath);
  removeIfPresent(metaTemp);
  removeIfPresent(eventTemp);
  if (!LittleFS.exists(queueDir)) LittleFS.mkdir(queueDir);

  Deck info[2];
  const bool valid0 = readMeta(0, info[0]);
  const bool valid1 = readMeta(1, info[1]);
  const int newest = valid1 && (!valid0 || info[1].generation > info[0].generation) ? 1 : 0;
  if ((newest ? valid1 : valid0) && openSlot(newest, info[newest])) return true;
  if (newest ? valid0 : valid1) openSlot(1 - newest, info[1 - newest]);
  return true;
}

bool AtenaStorage::initialize() {
  if (mounted || !LittleFS.format()) return false;
  return mount();
}

size_t AtenaStorage::freeBytes() const {
  const size_t total = LittleFS.totalBytes();
  const size_t used = LittleFS.usedBytes();
  return total > used ? total - used : 0;
}

bool AtenaStorage::startDownload(uint32_t bytes) {
  if (!mounted || !bytes || bytes > maxDeckBytes) return false;
  const int target = slot == 0 ? 1 : 0;
  return removeIfPresent(downloadPath) && removeIfPresent(metaTemp) && removeIfPresent(metadata[target]) &&
         removeIfPresent(decks[target]) && freeBytes() >= bytes + reserveBytes;
}

bool AtenaStorage::install(uint32_t version, uint32_t bytes, uint16_t count, const String& sha, const String& deviceId) {
  if (!mounted || !bytes || bytes > maxDeckBytes || !count || count > maxCards || sha.length() != 64 ||
      deviceId.length() != 36 || !version || active.generation == UINT32_MAX) return false;
  Deck next{active.generation + 1, version, bytes, count, sha, deviceId};
  File file = LittleFS.open(downloadPath, FILE_READ);
  std::unique_ptr<Card[]> staged(new (std::nothrow) Card[count]);
  if (!staged || !digestMatches(file, next) || !index(file, next, staged.get())) return false;
  file.close();
  const int target = slot == 0 ? 1 : 0;
  if (!LittleFS.rename(downloadPath, decks[target])) return false;

  JsonDocument doc;
  doc["generation"] = next.generation;
  doc["version"] = version;
  doc["bytes"] = bytes;
  doc["count"] = count;
  doc["sha"] = sha;
  doc["deviceId"] = deviceId;
  // Publishing metadata last commits this slot. The other slot stays bootable.
  if (!writeJsonFile(metaTemp, doc, 512) || !LittleFS.rename(metaTemp, metadata[target])) return false;
  memcpy(cards, staged.get(), sizeof(Card) * count);
  active = next;
  slot = target;
  return true;
}

void AtenaStorage::cancelDownload() {
  if (mounted) removeIfPresent(downloadPath);
}

uint32_t AtenaStorage::textOffset(uint16_t card, bool answer) const {
  if (slot < 0 || card >= active.count) return 0;
  return answer ? cards[card].answer : cards[card].question;
}

bool AtenaStorage::readPage(uint32_t offset, Page& result) const {
  if (slot < 0 || offset == 0 || offset >= active.bytes) return false;
  File file = LittleFS.open(decks[slot], FILE_READ);
  if (!file) return false;
  BufferedFile input(file, offset);
  return readAtenaPage(input, result);
}

uint16_t AtenaStorage::pendingEvents() const {
  File dir = LittleFS.open(queueDir);
  if (!dir || !dir.isDirectory()) return 0;
  uint16_t count = 0;
  for (File event = dir.openNextFile(); event; event = dir.openNextFile()) if (!event.isDirectory()) ++count;
  return count;
}

bool AtenaStorage::queueRating(uint16_t card, bool remembered, const char* timestamp) {
  if (slot < 0 || card >= active.count || !timestamp || freeBytes() < reserveBytes + 8192 ||
      pendingEvents() >= maxEvents) return false;
  File deck = LittleFS.open(decks[slot], FILE_READ);
  if (!deck) return false;
  BufferedFile input(deck, cards[card].id);
  char cardId[129];
  if (!readAscii(input, cardId, sizeof(cardId), false)) return false;

  char uuid[37];
  randomUuid(uuid);
  const String path = String(queueDir) + "/" + uuid + ".json";
  if (LittleFS.exists(path)) return false;
  JsonDocument doc;
  doc["id"] = uuid;
  doc["deviceId"] = active.deviceId;
  doc["cardId"] = cardId;
  doc["deckVersion"] = active.version;
  doc["rating"] = remembered ? "remembered" : "review";
  doc["studiedAt"] = timestamp;
  return removeIfPresent(eventTemp) && writeJsonFile(eventTemp, doc, 512) &&
         LittleFS.rename(eventTemp, path.c_str());
}
