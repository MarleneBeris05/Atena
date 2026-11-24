#pragma once

#include <stdint.h>

// The fixed-width Adafruit_GFX font is CP437 when cp437(true) is set.
// Accented capitals missing from CP437 use the base glyph and a drawn acute.
struct AtenaGlyph {
  uint8_t character;
  bool acute;
};

inline AtenaGlyph spanishGlyph(uint32_t point) {
  const bool ascii = point >= 32 && point <= 126;
  if (ascii) return {static_cast<uint8_t>(point), false};
  switch (point) {
    case 0x00e1: return {160, false};
    case 0x00e9: return {130, false};
    case 0x00ed: return {161, false};
    case 0x00f3: return {162, false};
    case 0x00fa: return {163, false};
    case 0x00f1: return {164, false};
    case 0x00d1: return {165, false};
    case 0x00fc: return {129, false};
    case 0x00dc: return {154, false};
    case 0x00bf: return {168, false};
    case 0x00a1: return {173, false};
    case 0x00c1: return {'A', true};
    case 0x00c9: return {144, false};
    case 0x00cd: return {'I', true};
    case 0x00d3: return {'O', true};
    case 0x00da: return {'U', true};
    case 0x00a0: return {' ', false};
    case 0x2013:
    case 0x2014: return {'-', false};
    case 0x2018:
    case 0x2019: return {39, false};
    case 0x201c:
    case 0x201d: return {'"', false};
    default: return {'?', false};
  }
}

enum class TextResult { Character, End, Invalid };

struct AtenaPage {
  static constexpr uint8_t columns = 19;
  static constexpr uint8_t rows = 8;
  uint32_t characters[rows][columns]{};
  uint32_t nextOffset = 0;
};

template <typename Reader>
bool readUtf8(Reader& input, int first, uint32_t& value) {
  if (first < 0) return false;
  if (first < 0x80) {
    value = first;
    return true;
  }
  int extra;
  uint32_t minimum;
  if (first >= 0xc2 && first <= 0xdf) { extra = 1; minimum = 0x80; value = first & 0x1f; }
  else if (first >= 0xe0 && first <= 0xef) { extra = 2; minimum = 0x800; value = first & 0x0f; }
  else if (first >= 0xf0 && first <= 0xf4) { extra = 3; minimum = 0x10000; value = first & 0x07; }
  else return false;
  for (int i = 0; i < extra; ++i) {
    const int byte = input.read();
    if (byte < 0x80 || byte > 0xbf) return false;
    value = (value << 6) | (byte & 0x3f);
  }
  return value >= minimum && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
}

template <typename Reader>
bool readHex(Reader& input, uint32_t& value) {
  value = 0;
  for (int i = 0; i < 4; ++i) {
    const int digit = input.read();
    if (digit >= '0' && digit <= '9') value = (value << 4) | (digit - '0');
    else if (digit >= 'a' && digit <= 'f') value = (value << 4) | (digit - 'a' + 10);
    else if (digit >= 'A' && digit <= 'F') value = (value << 4) | (digit - 'A' + 10);
    else return false;
  }
  return true;
}

template <typename Reader>
TextResult nextJsonCharacter(Reader& input, uint32_t& value) {
  const int first = input.read();
  if (first == '"') return TextResult::End;
  if (first < 0x20) return TextResult::Invalid;
  if (first != '\\') return readUtf8(input, first, value) ? TextResult::Character : TextResult::Invalid;
  switch (input.read()) {
    case '"': value = '"'; break;
    case '\\': value = '\\'; break;
    case '/': value = '/'; break;
    case 'b': value = '\b'; break;
    case 'f': value = '\f'; break;
    case 'n': value = '\n'; break;
    case 'r': value = '\r'; break;
    case 't': value = '\t'; break;
    case 'u': {
      if (!readHex(input, value)) return TextResult::Invalid;
      if (value >= 0xd800 && value <= 0xdbff) {
        uint32_t tail;
        if (input.read() != '\\' || input.read() != 'u' || !readHex(input, tail) || tail < 0xdc00 || tail > 0xdfff) {
          return TextResult::Invalid;
        }
        value = 0x10000 + ((value - 0xd800) << 10) + (tail - 0xdc00);
      } else if (value >= 0xdc00 && value <= 0xdfff) return TextResult::Invalid;
      break;
    }
    default: return TextResult::Invalid;
  }
  return TextResult::Character;
}

inline uint32_t composeSpanish(uint32_t base, uint32_t mark) {
  if (mark == 0x0303) return base == 'n' ? 0x00f1 : base == 'N' ? 0x00d1 : 0;
  if (mark == 0x0308) return base == 'u' ? 0x00fc : base == 'U' ? 0x00dc : 0;
  if (mark != 0x0301) return 0;
  switch (base) {
    case 'a': return 0x00e1;
    case 'e': return 0x00e9;
    case 'i': return 0x00ed;
    case 'o': return 0x00f3;
    case 'u': return 0x00fa;
    case 'A': return 0x00c1;
    case 'E': return 0x00c9;
    case 'I': return 0x00cd;
    case 'O': return 0x00d3;
    case 'U': return 0x00da;
    default: return 0;
  }
}

template <typename Reader>
bool readAtenaPage(Reader& input, AtenaPage& result) {
  result = AtenaPage{};
  unsigned row = 0, column = 0;
  for (;;) {
    const uint32_t before = input.position();
    uint32_t point;
    const auto next = nextJsonCharacter(input, point);
    if (next == TextResult::End) return true;
    if (next == TextResult::Invalid) return false;
    if (point == '\r') continue;
    if (column) {
      uint32_t& previous = result.characters[row][column - 1];
      if (const uint32_t composed = composeSpanish(previous, point)) {
        previous = composed;
        continue;
      }
    }
    if (point == '\n') {
      if (++row == AtenaPage::rows) {
        if (input.peek() != '"') result.nextOffset = input.position();
        return true;
      }
      column = 0;
      continue;
    }
    if (column == AtenaPage::columns) {
      if (++row == AtenaPage::rows) {
        result.nextOffset = before;
        return true;
      }
      column = 0;
    }
    result.characters[row][column++] = point == '\t' ? ' ' : point;
  }
}
