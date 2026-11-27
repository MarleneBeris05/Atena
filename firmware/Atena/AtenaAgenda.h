#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <memory>

class AtenaAgenda {
 public:
  static constexpr uint8_t maxSessions = 48;
  static constexpr size_t maxResponse = 20000;
  enum Result : uint8_t { Pending, Completed, Skipped };

  struct Entry {
    char id[37];
    char topic[161];
    uint32_t start;
    uint32_t finished;
    uint16_t minutes;
    uint8_t seen;
    Result result;
  };

  void begin(const String& device);
  size_t size() const { return active ? active->count : 0; }
  const Entry& get(size_t index) const { return active->entries[index]; }
  bool mark(size_t index, uint8_t bit);
  bool finish(size_t index, Result result, uint32_t utc);
  bool install(const JsonDocument& document, const String& device);

 private:
  struct Snapshot {
    char device[37];
    uint8_t count;
    uint32_t generation;
    uint32_t revision;
    Entry entries[maxSessions];
  };

  std::unique_ptr<Snapshot> active;
  int slot = -1;
  std::unique_ptr<Snapshot> read(int position, const String& device);
  bool store(std::unique_ptr<Snapshot> candidate);
  static size_t bytes(const Snapshot& snapshot);
  static bool valid(const Entry& entry);
};
