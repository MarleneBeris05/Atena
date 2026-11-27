#include "../Atena/AtenaPomodoro.h"

#include <cassert>
#include <limits>

int main() {
  using Phase = PomodoroTimer::Phase;
  PomodoroTimer timer;
  const uint32_t start = std::numeric_limits<uint32_t>::max() - 500;
  timer.start({1, 1}, start);
  auto frame = timer.update(start);
  assert(frame.phase == Phase::Work && frame.greeting && frame.remainingSeconds == 60);
  assert(timer.update(start + 1799).greeting);
  assert(!timer.update(start + 1800).greeting);
  frame = timer.update(start + 59999);
  assert(frame.phase == Phase::Work && frame.remainingSeconds == 1);
  frame = timer.update(start + 60000);
  assert(frame.phase == Phase::Rest && frame.remainingSeconds == 60);
  frame = timer.update(start + 119999);
  assert(frame.phase == Phase::Rest && frame.remainingSeconds == 1);
  frame = timer.update(start + 120000);
  assert(frame.phase == Phase::Alert && frame.brightness == 0);
  const auto rising = timer.update(start + 120625).brightness;
  assert(rising > 0 && rising < 255);
  assert(timer.update(start + 121250).brightness == 255);
  assert(timer.update(start + 121875).brightness == rising);
  assert(timer.update(start + 122500).brightness == 0);
  assert(timer.update(start + 123750).brightness == 255);
  assert(timer.update(start + 124999).phase == Phase::Alert);
  assert(timer.update(start + 125000).phase == Phase::Done);

  timer.start({1, 1}, start + 125000);
  frame = timer.update(start + 125000);
  assert(frame.phase == Phase::Work && frame.greeting && frame.remainingSeconds == 60);
  timer.start({25, 5}, 0);
  assert(timer.update(0).remainingSeconds == 25 * 60);
  // A delayed frame still consumes all elapsed time, including time already spent in rest.
  frame = timer.update(25 * 60000 + 1500);
  assert(frame.phase == Phase::Rest && frame.remainingSeconds == 299);

  timer.start({2147483647, 1}, 0);
  assert(timer.update(0).remainingSeconds == 2147483647ULL * 60);
}
