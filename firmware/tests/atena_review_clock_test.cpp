#include "../Atena/AtenaReviewClock.h"

#include <cassert>
#include <ctime>
#include <limits>
#include <initializer_list>

int main() {
  const uint32_t at1800 = 1796256000;
  std::time_t local = at1800 - 6 * 3600;
  const auto* reading = std::gmtime(&local);
  assert(reading->tm_hour == 18 && reading->tm_min == 0);
  uint8_t seen = 0;
  for (uint8_t minutes : {30, 15, 10, 5, 3}) {
    const auto at = at1800 - minutes * 60;
    assert(!reviewNotice(at - 2, at - 1, at1800, seen).bit);
    const auto notice = reviewNotice(at - 1, at, at1800, seen);
    assert(notice.bit && notice.minutes == minutes);
    seen |= notice.bit;
    assert(!reviewNotice(at - 1, at, at1800, seen).bit);
  }
  const auto due = reviewNotice(at1800 - 1, at1800, at1800, seen);
  assert(due.bit == reviewDue && !due.minutes);
  assert(!reviewNotice(at1800, at1800 + 3600, at1800, seen | due.bit).bit);
  assert(reviewNotice(at1800 + 3599, at1800 + 3600, at1800, 0).bit == reviewDue);
  assert(!reviewNotice(at1800 - 241, at1800 - 240, at1800, 0).bit);
  assert(reviewNotice(at1800 - 181, at1800 - 180, at1800, 0).minutes == 3);

  const auto started = std::numeric_limits<uint32_t>::max() - 100;
  assert(reviewRemaining(started, started, 1) == 60);
  assert(reviewRemaining(started, started + 999, 1) == 60);
  assert(reviewRemaining(started, started + 1000, 1) == 59);
  assert(reviewRemaining(started, started + 59999, 1) == 1);
  assert(!reviewRemaining(started, started + 60000, 1));
}
