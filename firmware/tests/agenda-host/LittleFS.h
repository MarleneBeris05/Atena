#pragma once
#include <filesystem>
#include <fstream>
#include <string>
inline const char* FILE_READ = "r";
inline const char* FILE_WRITE = "w";
inline size_t failAfter = SIZE_MAX;
class File {
 public:
  File(std::filesystem::path path, bool writing) : path(path), file(path,
      std::ios::binary | (writing ? std::ios::out | std::ios::trunc : std::ios::in)) {}
  explicit operator bool() const { return file.is_open(); }
  size_t read(uint8_t* buffer, size_t length) {
    file.read(reinterpret_cast<char*>(buffer), length);
    return file.gcount();
  }
  size_t write(const uint8_t* buffer, size_t length) {
    const auto amount = std::min(length, failAfter);
    if (failAfter != SIZE_MAX) failAfter -= amount;
    file.write(reinterpret_cast<const char*>(buffer), amount);
    return file ? amount : 0;
  }
  size_t size() const { return std::filesystem::file_size(path); }
  void flush() { file.flush(); }
  void close() { file.close(); }
 private:
  std::filesystem::path path;
  std::fstream file;
};
struct FakeLittleFS {
  std::filesystem::path root;
  File open(const char* name, const char* mode) { return File(root / (name + 1), mode[0] == 'w'); }
};
inline FakeLittleFS LittleFS;
