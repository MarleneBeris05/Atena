#pragma once

#include <Arduino.h>
#include <FS.h>

#include "AtenaText.h"

class AtenaStorage {
 public:
  static constexpr uint32_t maxDeckBytes = 1024 * 1024;
  static constexpr uint16_t maxCards = 500;
  static constexpr uint32_t reserveBytes = 32 * 1024;
  static constexpr uint16_t maxEvents = 48;
  static constexpr const char* downloadPath = "/deck.tmp";

  struct Deck {
    uint32_t generation = 0;
    uint32_t version = 0;
    uint32_t bytes = 0;
    uint16_t count = 0;
    String sha;
    String deviceId;
  };

  using Page = AtenaPage;

  bool mount();
  bool initialize();
  bool ready() const { return mounted; }
  const Deck& current() const { return active; }
  bool startDownload(uint32_t bytes);
  bool install(uint32_t version, uint32_t bytes, uint16_t count, const String& sha, const String& deviceId);
  void cancelDownload();
  uint32_t textOffset(uint16_t card, bool answer) const;
  bool readPage(uint32_t offset, Page& result) const;
  bool queueRating(uint16_t card, bool remembered, const char* timestamp);
  uint16_t pendingEvents() const;

 private:
  struct Card {
    uint32_t id = 0;
    uint32_t question = 0;
    uint32_t answer = 0;
  };

  bool mounted = false;
  int slot = -1;
  Deck active;
  Card cards[maxCards]{};

  static bool index(File& source, const Deck& info, Card* output);
  static bool readMeta(int candidate, Deck& info);
  bool openSlot(int candidate, const Deck& info);
  size_t freeBytes() const;
};
