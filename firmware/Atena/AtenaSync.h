#pragma once

#include "AtenaStorage.h"

#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>

class AtenaSync {
 public:
  explicit AtenaSync(AtenaStorage& storage) : storage(storage) {}

  void begin();
  bool configureNetwork(const char* json);
  bool initializeStorage();
  int timezoneOffset() { return settings.getInt("utcOffset", -360); }
  bool setTimezoneOffset(int minutes);
  const char* start(time_t utc);
  const char* poll(uint32_t now);
  void cancel();
  const String& pairingCode() const { return code; }

 private:
  AtenaStorage& storage;
  Preferences settings;
  bool configured = false;
  String deviceId;
  String token;
  String code;
  String pairingId;
  String pollToken;
  uint32_t nextPoll = 0;
  uint32_t pairingDeadline = 0;
  uint32_t pollInterval = 5000;

  bool connectWiFi();
  bool sendEvents();
  bool confirm(const AtenaStorage::Deck& deck);
  bool download(uint32_t version, uint32_t bytes);
  int jsonRequest(const char* method, const String& path, const String& auth, const String& body, JsonDocument& output);
  const char* startPairing();
  const char* synchronize();
  const char* finish(const char* message);
};
