#include "AtenaAgenda.h"
#include "AtenaReviewClock.h"
#include <LittleFS.h>
#include <cassert>
#include <chrono>
#include <iostream>

int main() {
  LittleFS.root = std::filesystem::temp_directory_path() /
      ("agenda-host-run-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
  std::filesystem::create_directory(LittleFS.root);
  const String owner("7a32f265-17e5-4227-af3a-88a14bfb81f3");
  JsonDocument document;
  assert(!deserializeJson(document, R"({"schemaVersion":1,"revision":1,"sessions":[
    {"id":"d02c9f62-2817-406b-83cc-36bf5cc782bd","topic":"Topologías","start":1796256000,"minutes":1}]})"));
  {
    AtenaAgenda agenda;
    agenda.begin(owner);
    assert(agenda.size() == 0 && agenda.install(document, owner));
    const auto event = reviewNotice(1796255699, 1796255700, agenda.get(0).start, agenda.get(0).seen);
    assert(event.minutes == 5 && agenda.mark(0, event.bit));
  }
  {
    AtenaAgenda rebooted;
    rebooted.begin(owner);
    assert(rebooted.size() == 1 && rebooted.get(0).minutes == 1);
    assert(!reviewNotice(1796255699, 1796255700, rebooted.get(0).start, rebooted.get(0).seen).bit);
    assert(reviewNotice(1796255819, 1796255820, rebooted.get(0).start, rebooted.get(0).seen).minutes == 3);
    document["revision"] = 2;
    document["sessions"][0]["topic"] = "Una versión editada";
    failAfter = 64;
    assert(!rebooted.install(document, owner));
    failAfter = SIZE_MAX;
  }
  AtenaAgenda again;
  again.begin(owner);
  assert(again.size() == 1 && std::string(again.get(0).topic) == "Topologías");
  assert(again.finish(0, AtenaAgenda::Completed, 1796256060));
  AtenaAgenda last;
  last.begin(owner);
  assert(last.get(0).result == AtenaAgenda::Completed && last.get(0).finished == 1796256060);
  document["sessions"].to<JsonArray>();
  assert(last.install(document, owner));
  AtenaAgenda cancelled;
  cancelled.begin(owner);
  assert(cancelled.size() == 0);
  std::filesystem::remove(LittleFS.root / "agenda-a.v1");
  std::filesystem::remove(LittleFS.root / "agenda-b.v1");
  std::filesystem::remove(LittleFS.root);
  std::cout << "Agenda: restart, persisted notice and result, interrupted replacement, cancellation passed.\n";
}
