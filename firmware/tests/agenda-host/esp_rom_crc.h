#pragma once
#include <cstdint>
inline uint32_t esp_rom_crc32_le(uint32_t crc, const uint8_t* data, uint32_t size) {
  while (size--) {
    crc ^= *data++;
    for (int i = 0; i < 8; ++i) crc = (crc >> 1) ^ (0xEDB88320 & (0 - (crc & 1)));
  }
  return crc;
}
