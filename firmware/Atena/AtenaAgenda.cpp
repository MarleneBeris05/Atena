#include "AtenaAgenda.h"

#include <LittleFS.h>
#include <esp_rom_crc.h>
#include <new>

namespace {
const char* paths[] = {"/agenda-a.v1", "/agenda-b.v1"};
constexpr uint32_t firstDate = 1703980800;
constexpr uint32_t lastDate = 4102617600;

bool validId(const char* id) {
  if (strlen(id) != 36) return false;
  for (size_t i = 0; i < 36; ++i) {
    const char ch = id[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (ch != '-') return false;
    } else if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) return false;
  }
  return true;
}
}

size_t AtenaAgenda::bytes(const Snapshot& snapshot) {
  return offsetof(Snapshot, entries) + snapshot.count * sizeof(Entry);
}

bool AtenaAgenda::valid(const Entry& entry) {
  return entry.id[36] == '\0' && validId(entry.id) && entry.topic[160] == '\0' && entry.topic[0] &&
      entry.start >= firstDate && entry.start <= lastDate && entry.minutes >= 1 && entry.minutes <= 180 &&
      entry.seen <= 63 && entry.result <= Skipped && (!entry.result || entry.finished >= entry.start);
}

std::unique_ptr<AtenaAgenda::Snapshot> AtenaAgenda::read(int position, const String& device) {
  std::unique_ptr<Snapshot> snapshot(new (std::nothrow) Snapshot{});
  File file = LittleFS.open(paths[position], FILE_READ);
  const size_t header = offsetof(Snapshot, entries);
  if (!snapshot || !file || file.read(reinterpret_cast<uint8_t*>(snapshot.get()), header) != header ||
      snapshot->count > maxSessions || snapshot->device[36] != '\0' || device != snapshot->device ||
      file.size() != bytes(*snapshot) + sizeof(uint32_t)) return {};
  const size_t length = bytes(*snapshot) - header;
  uint32_t checksum = 0;
  if (file.read(reinterpret_cast<uint8_t*>(snapshot->entries), length) != length ||
      file.read(reinterpret_cast<uint8_t*>(&checksum), sizeof(checksum)) != sizeof(checksum) ||
      esp_rom_crc32_le(0, reinterpret_cast<const uint8_t*>(snapshot.get()), bytes(*snapshot)) != checksum) return {};
  for (size_t i = 0; i < snapshot->count; ++i) if (!valid(snapshot->entries[i])) return {};
  return snapshot;
}

void AtenaAgenda::begin(const String& device) {
  active.reset();
  slot = -1;
  if (device.length() != 36) return;
  for (int i = 0; i < 2; ++i) {
    auto candidate = read(i, device);
    if (candidate && (!active || candidate->generation > active->generation)) {
      active = std::move(candidate);
      slot = i;
    }
  }
}

bool AtenaAgenda::store(std::unique_ptr<Snapshot> candidate) {
  const int target = slot == 0 ? 1 : 0;
  candidate->generation = active ? active->generation + 1 : 1;
  const auto* data = reinterpret_cast<const uint8_t*>(candidate.get());
  const size_t length = bytes(*candidate);
  const uint32_t checksum = esp_rom_crc32_le(0, data, length);
  File file = LittleFS.open(paths[target], FILE_WRITE);
  if (!file || file.write(data, length) != length ||
      file.write(reinterpret_cast<const uint8_t*>(&checksum), sizeof(checksum)) != sizeof(checksum)) return false;
  file.flush();
  file.close();
  auto verified = read(target, candidate->device);
  if (!verified || verified->generation != candidate->generation) return false;
  active = std::move(verified);
  slot = target;
  return true;
}

bool AtenaAgenda::mark(size_t index, uint8_t bit) {
  std::unique_ptr<Snapshot> candidate(new (std::nothrow) Snapshot(*active));
  if (!candidate) return false;
  candidate->entries[index].seen |= bit;
  return store(std::move(candidate));
}

bool AtenaAgenda::finish(size_t index, Result result, uint32_t utc) {
  std::unique_ptr<Snapshot> candidate(new (std::nothrow) Snapshot(*active));
  if (!candidate) return false;
  auto& entry = candidate->entries[index];
  if (entry.result) return entry.result == result;
  entry.result = result;
  entry.finished = max(utc, entry.start);
  return store(std::move(candidate));
}

bool AtenaAgenda::install(const JsonDocument& document, const String& device) {
  const JsonArrayConst sessions = document["sessions"].as<JsonArrayConst>();
  if ((document["schemaVersion"] | 0) != 1 || !document["revision"].is<uint32_t>() ||
      sessions.isNull() || sessions.size() > maxSessions || device.length() != 36) return false;
  const uint32_t revision = document["revision"].as<uint32_t>();
  if (active && revision < active->revision) return false;
  std::unique_ptr<Snapshot> candidate(new (std::nothrow) Snapshot{});
  if (!candidate) return false;
  device.toCharArray(candidate->device, sizeof(candidate->device));
  candidate->revision = revision;
  for (JsonObjectConst session : sessions) {
    const char* id = session["id"] | "";
    const char* topic = session["topic"] | "";
    auto& entry = candidate->entries[candidate->count];
    if (strlen(id) != 36 || strlen(topic) >= sizeof(entry.topic) ||
        !session["start"].is<uint32_t>() || !session["minutes"].is<uint16_t>()) return false;
    memcpy(entry.id, id, sizeof(entry.id));
    memcpy(entry.topic, topic, strlen(topic) + 1);
    entry.start = session["start"].as<uint32_t>();
    entry.minutes = session["minutes"].as<uint16_t>();
    if (!valid(entry) || (candidate->count && entry.start < candidate->entries[candidate->count - 1].start)) return false;
    for (size_t i = 0; i < candidate->count; ++i) {
      if (strcmp(entry.id, candidate->entries[i].id) == 0) return false;
    }
    for (size_t i = 0; i < size(); ++i) {
      const auto& previous = get(i);
      if (entry.start == previous.start && strcmp(entry.id, previous.id) == 0) {
        entry.seen = previous.seen;
        entry.result = previous.result;
        entry.finished = previous.finished;
        break;
      }
    }
    ++candidate->count;
  }
  if (active && active->revision == revision && active->count == candidate->count &&
      memcmp(active->entries, candidate->entries, candidate->count * sizeof(Entry)) == 0) return true;
  return store(std::move(candidate));
}
