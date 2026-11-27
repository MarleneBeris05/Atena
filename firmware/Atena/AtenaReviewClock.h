#pragma once

#include <stdint.h>

struct ReviewNotice {
  uint8_t bit;
  uint8_t minutes;
};

constexpr uint8_t reviewDue = 1 << 5;
constexpr uint8_t reviewThresholds[] = {3, 5, 10, 15, 30};

inline ReviewNotice reviewNotice(uint32_t previous, uint32_t now, uint32_t start, uint8_t seen) {
  if (now >= start) return {(seen & reviewDue) ? uint8_t{0} : reviewDue, 0};
  for (unsigned i = 0; i < sizeof(reviewThresholds); ++i) {
    const uint32_t instant = start - reviewThresholds[i] * 60;
    const auto bit = static_cast<uint8_t>(1 << i);
    if (previous < instant && now >= instant && !(seen & bit)) return {bit, reviewThresholds[i]};
  }
  return {};
}

inline uint32_t reviewRemaining(uint32_t began, uint32_t now, uint16_t minutes) {
  const uint32_t elapsed = now - began;
  const uint32_t duration = minutes * 60000UL;
  return elapsed < duration ? (duration - elapsed + 999) / 1000 : 0;
}
