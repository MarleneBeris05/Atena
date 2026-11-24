#include <cassert>
#include <string>

#include "../Atena/AtenaText.h"

struct MemoryText {
  const std::string& bytes;
  uint32_t cursor = 0;
  int peek() const { return cursor < bytes.size() ? static_cast<unsigned char>(bytes[cursor]) : -1; }
  int read() { const int value = peek(); if (value >= 0) ++cursor; return value; }
  uint32_t position() const { return cursor; }
};

int main() {
  const std::string spanish = u8R"JSON(¿ÁÉÍÓÚ, ñ ü?\"\n\u00f1\ud83d\ude42")JSON";
  MemoryText input{spanish};
  AtenaPage page;
  assert(readAtenaPage(input, page));
  assert(page.characters[0][0] == 0x00bf);
  assert(spanishGlyph(page.characters[0][1]).acute);
  assert(spanishGlyph(page.characters[0][2]).character == 144);
  assert(spanishGlyph(page.characters[0][8]).character == 164);
  assert(page.characters[1][0] == 0x00f1);
  assert(page.characters[1][1] == 0x1f642);
  assert(page.nextOffset == 0);

  const size_t cells = AtenaPage::columns * AtenaPage::rows;
  const std::string split = std::string(cells - 1, 'a') + u8"n\u0303á\\r\\nÑ\"";
  MemoryText first{split};
  assert(readAtenaPage(first, page));
  assert(page.characters[AtenaPage::rows - 1][AtenaPage::columns - 1] == 0x00f1);
  assert(page.nextOffset == cells + 2);
  MemoryText second{split, page.nextOffset};
  assert(readAtenaPage(second, page));
  assert(page.characters[0][0] == 0x00e1 && page.characters[1][0] == 0x00d1);
  assert(page.nextOffset == 0);

  const std::string longText = std::string(24000, 'x') + '"';
  size_t total = 0;
  uint32_t offset = 0;
  do {
    MemoryText source{longText, offset};
    assert(readAtenaPage(source, page));
    for (const auto& row : page.characters) for (const uint32_t ch : row) if (ch) ++total;
    assert(!page.nextOffset || page.nextOffset > offset);
    offset = page.nextOffset;
  } while (offset);
  assert(total == 24000);

  const std::string malformed = "\xed\xa0\x80\"";
  MemoryText invalid{malformed};
  assert(!readAtenaPage(invalid, page));
}
