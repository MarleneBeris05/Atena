#pragma once

#include <stdint.h>

struct PomodoroMinutes {
  uint32_t work;
  uint32_t rest;
};

class PomodoroTimer {
 public:
  enum class Phase { Work, Rest, Alert, Done };

  struct Frame {
    Phase phase;
    uint64_t remainingSeconds;
    bool greeting;
    uint8_t brightness;
  };

  void start(PomodoroMinutes minutes, uint32_t now) {
    workMs = uint64_t{minutes.work} * 60000;
    endMs = workMs + uint64_t{minutes.rest} * 60000;
    elapsed = 0;
    last = now;
  }

  Frame update(uint32_t now) {
    // Unsigned differences account for millis() wrapping between frames.
    elapsed += now - last;
    last = now;
    if (elapsed < workMs) return {Phase::Work, secondsLeft(workMs), elapsed < 1800, 0};
    if (elapsed < endMs) return {Phase::Rest, secondsLeft(endMs), false, 0};
    if (elapsed >= endMs + 5000) return {Phase::Done, 0, false, 0};

    const uint32_t pulse = (elapsed - endMs) % 2500;
    const float ramp = (pulse <= 1250 ? pulse : 2500 - pulse) / 1250.0f;
    const float brightness = ramp * ramp * (3 - 2 * ramp);
    return {Phase::Alert, 0, false, static_cast<uint8_t>(brightness * 255)};
  }

 private:
  uint64_t secondsLeft(uint64_t until) const {
    return (until - elapsed + 999) / 1000;
  }

  uint64_t workMs = 0;
  uint64_t endMs = 0;
  uint64_t elapsed = 0;
  uint32_t last = 0;
};
