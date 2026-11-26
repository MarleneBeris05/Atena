#pragma once
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <string>
#include <utility>
using std::max;
class String {
 public:
  String(const char* value) : text(value) {}
  size_t length() const { return text.size(); }
  bool operator!=(const char* value) const { return text != value; }
  void toCharArray(char* output, size_t size) const {
    std::strncpy(output, text.c_str(), size - 1);
    output[size - 1] = 0;
  }
 private:
  std::string text;
};
