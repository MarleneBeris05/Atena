#include <Wire.h>
#include <RTClib.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <SPI.h>
#include <esp_random.h>

#include <vector>

#include "AtenaStorage.h"
#include "AtenaSync.h"
#include "AtenaText.h"

constexpr int TFT_DC = 16;
constexpr int TFT_RST = 17;
constexpr int ANCHO = 240;
constexpr int ALTO = 240;
constexpr int BARRA_Y = 8;
constexpr int BARRA_ANCHO_BASE = 160;
constexpr int BARRA_ALTO_BASE = 12;
constexpr int BARRA_ALTO_FINAL = 18;
constexpr int AJUSTE_HORA_X = 2;
constexpr int CUERPO_Y = 33;
constexpr int PIE_Y = 216;

constexpr int PIN_BATERIA = 35;
constexpr float FACTOR_DIVISOR = 3.0f;
constexpr int LECTURAS_PARA_CONFIRMAR = 3;
constexpr bool LECTURA_BATERIA_VERIFICADA = false;
constexpr int PIN_ESTADO_CARGA = -1;
constexpr bool SENAL_CARGA_VERIFICADA = false;

constexpr int PIN_BTN[] = {25, 26, 27};
bool lecturaBtn[] = {HIGH, HIGH, HIGH};
bool estadoBtn[] = {HIGH, HIGH, HIGH};
uint32_t tBtn[] = {0, 0, 0};

constexpr int OJOS_Y = 110;
constexpr int LIENZO_H = 100;
constexpr int ANCHO_OJO = 56;
constexpr int ALTO_OJO = 70;
constexpr int RADIO_OJO = 16;
constexpr int OJO_IZQ_X = 75;
constexpr int OJO_DER_X = 165;
constexpr uint16_t COLOR_OJO = ST77XX_CYAN;
constexpr int DURACION_PARPADEO = 220;

Adafruit_ST7789 tft(-1, TFT_DC, TFT_RST);
GFXcanvas16 lienzo(ANCHO, LIENZO_H);
GFXcanvas16 barraBase(BARRA_ANCHO_BASE, BARRA_ALTO_BASE);
GFXcanvas16 barraFinal(ANCHO, BARRA_ALTO_FINAL);
RTC_DS3231 rtc;
AtenaStorage storage;
AtenaSync sincronizador(storage);

enum class Pantalla { Inicio, Menu, Pregunta, Respuesta, Valorar, Sincronizar, Vincular, Mensaje };
Pantalla pantalla = Pantalla::Inicio;
Pantalla regreso = Pantalla::Menu;
int seleccion = 0;
uint16_t tarjeta = 0;
size_t pagina = 0;
std::vector<uint32_t> offsetsPagina;
AtenaStorage::Page textoPagina;
const char* mensaje = "";
bool rtcDisponible = false;
bool relojConfiable = false;
int ultimoSegundo = -2;
int porcentajeBateria = -1;
int ultimoPorcentajeMostrado = -2;
bool ultimaCargaMostrada = false;
float miraX = 0, miraY = 0;
float destinoX = 0, destinoY = 0;
float altoOjo = ALTO_OJO;
bool parpadeando = false;
bool feliz = false;
uint32_t tInicioParpadeo = 0;
uint32_t tSiguienteParpadeo = 2000;
uint32_t tSiguienteMirada = 1500;
uint32_t tUltimoFrame = 0;
uint32_t tUltimaLectura = 0;
uint32_t tUltimaBateria = 0;
uint32_t tFinFeliz = 0;

bool vencido(uint32_t ahora, uint32_t limite) {
  return static_cast<int32_t>(ahora - limite) >= 0;
}

int calcularPorcentaje(float v) {
  const float voltajes[] = {3.00, 3.30, 3.50, 3.60, 3.70, 3.80, 3.90, 4.00, 4.10, 4.20};
  const int porcentajes[] = {0, 5, 10, 20, 40, 60, 75, 85, 95, 100};
  if (v <= voltajes[0]) return 0;
  for (int i = 0; i < 9; i++) {
    if (v <= voltajes[i + 1]) {
      const float fraccion = (v - voltajes[i]) / (voltajes[i + 1] - voltajes[i]);
      return porcentajes[i] + fraccion * (porcentajes[i + 1] - porcentajes[i]);
    }
  }
  return 100;
}

void leerBateria() {
  static int candidato = -1;
  static int repeticiones = 0;
  if (!LECTURA_BATERIA_VERIFICADA) {
    porcentajeBateria = -1;
    return;
  }
  uint32_t suma = 0;
  for (int i = 0; i < 20; i++) {
    suma += analogReadMilliVolts(PIN_BATERIA);
    delay(2);
  }
  const float voltaje = (suma / 20000.0f) * FACTOR_DIVISOR;
  if (voltaje < 2.5f || voltaje > 4.3f) {
    porcentajeBateria = candidato = -1;
    repeticiones = 0;
    return;
  }
  const int lectura = calcularPorcentaje(voltaje);
  if (lectura != candidato) {
    candidato = lectura;
    repeticiones = 1;
  } else if (repeticiones < LECTURAS_PARA_CONFIRMAR) {
    ++repeticiones;
  }
  if (repeticiones >= LECTURAS_PARA_CONFIRMAR) porcentajeBateria = candidato;
}

bool cargando() {
  return SENAL_CARGA_VERIFICADA && PIN_ESTADO_CARGA >= 0 && digitalRead(PIN_ESTADO_CARGA) == LOW;
}

time_t horaUtc() {
  if (!rtcDisponible || !relojConfiable || rtc.lostPower()) return 0;
  const DateTime local = rtc.now();
  if (!local.isValid() || local.year() < 2024) return 0;
  return static_cast<time_t>(local.unixtime()) - sincronizador.timezoneOffset() * 60;
}

bool fechaDeEstudio(char (&iso)[25]) {
  const time_t utc = horaUtc();
  tm date{};
  return utc && gmtime_r(&utc, &date) && strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%SZ", &date);
}

void actualizarBarraSuperior() {
  const DateTime ahoraRTC = rtcDisponible ? rtc.now() : DateTime(2000, 1, 1);
  const bool fechaValida = relojConfiable && ahoraRTC.isValid() && ahoraRTC.year() >= 2024;
  const int segundo = fechaValida ? ahoraRTC.second() : -1;
  const bool hayCarga = cargando();
  if (segundo == ultimoSegundo && porcentajeBateria == ultimoPorcentajeMostrado &&
      hayCarga == ultimaCargaMostrada) return;
  ultimoSegundo = segundo;
  ultimoPorcentajeMostrado = porcentajeBateria;
  ultimaCargaMostrada = hayCarga;

  char fecha[9] = "--/--/--";
  char hora[9] = "--:--:--";
  char porcentaje[5] = "--%";
  if (fechaValida) {
    snprintf(fecha, sizeof(fecha), "%02d/%02d/%02d", ahoraRTC.day(), ahoraRTC.month(), ahoraRTC.year() % 100);
    snprintf(hora, sizeof(hora), "%02d:%02d:%02d", ahoraRTC.hour(), ahoraRTC.minute(), segundo);
  }
  if (porcentajeBateria >= 0) snprintf(porcentaje, sizeof(porcentaje), "%d%%", porcentajeBateria);

  barraBase.fillScreen(ST77XX_BLACK);
  barraBase.setTextSize(1);
  barraBase.setTextWrap(false);
  constexpr int margen = 3;
  constexpr int textoY = 2;
  barraBase.setTextColor(ST77XX_CYAN);
  barraBase.setCursor(margen, textoY);
  barraBase.print(fecha);
  const int horaX = (BARRA_ANCHO_BASE - strlen(hora) * 6) / 2 + AJUSTE_HORA_X;
  barraBase.setTextColor(ST77XX_WHITE);
  barraBase.setCursor(horaX, textoY);
  barraBase.print(hora);
  const int porcentajeX = BARRA_ANCHO_BASE - margen - strlen(porcentaje) * 6;
  barraBase.setCursor(porcentajeX, textoY);
  barraBase.print(porcentaje);

  constexpr int cuerpoAncho = 18;
  constexpr int cuerpoAlto = 10;
  constexpr int terminalAncho = 2;
  constexpr int bateriaY = 1;
  const int bateriaX = porcentajeX - 3 - terminalAncho - cuerpoAncho;
  barraBase.drawRoundRect(bateriaX, bateriaY, cuerpoAncho, cuerpoAlto, 2, ST77XX_WHITE);
  barraBase.fillRect(bateriaX + cuerpoAncho, bateriaY + 3, terminalAncho, 4, ST77XX_WHITE);
  if (porcentajeBateria >= 0) {
    const uint16_t color = porcentajeBateria <= 20 ? ST77XX_RED : porcentajeBateria <= 50 ? ST77XX_YELLOW : ST77XX_GREEN;
    const int ancho = (porcentajeBateria * (cuerpoAncho - 4) + 50) / 100;
    if (ancho) barraBase.fillRect(bateriaX + 2, bateriaY + 2, ancho, cuerpoAlto - 4, color);
  }
  if (hayCarga) {
    barraBase.drawLine(bateriaX + 10, bateriaY + 2, bateriaX + 7, bateriaY + 5, ST77XX_YELLOW);
    barraBase.drawFastHLine(bateriaX + 7, bateriaY + 5, 4, ST77XX_YELLOW);
    barraBase.drawLine(bateriaX + 10, bateriaY + 5, bateriaX + 7, bateriaY + 8, ST77XX_YELLOW);
  }

  const uint16_t* origen = barraBase.getBuffer();
  uint16_t* destino = barraFinal.getBuffer();
  for (int y = 0; y < BARRA_ALTO_FINAL; y++) {
    const int filaOrigen = (y * 2 / 3) * BARRA_ANCHO_BASE;
    for (int x = 0; x < ANCHO; x++) destino[y * ANCHO + x] = origen[filaOrigen + x * 2 / 3];
  }
  tft.drawRGBBitmap(0, BARRA_Y, destino, ANCHO, BARRA_ALTO_FINAL);
}

void actualizarAnimacion(uint32_t ahora) {
  if (vencido(ahora, tSiguienteMirada)) {
    if (random(3) == 0) {
      destinoX = 0;
      destinoY = 0;
    } else {
      destinoX = random(-18, 19);
      destinoY = random(-8, 9);
    }
    tSiguienteMirada = ahora + random(1500, 4000);
  }
  miraX += (destinoX - miraX) * 0.25f;
  miraY += (destinoY - miraY) * 0.25f;

  if (!parpadeando && vencido(ahora, tSiguienteParpadeo)) {
    parpadeando = true;
    tInicioParpadeo = ahora;
  }
  if (parpadeando) {
    const float t = (ahora - tInicioParpadeo) / static_cast<float>(DURACION_PARPADEO);
    if (t >= 1.0f) {
      parpadeando = false;
      altoOjo = ALTO_OJO;
      tSiguienteParpadeo = ahora + random(2000, 5000);
    } else {
      const float k = t < 0.5f ? t * 2 : (1 - t) * 2;
      altoOjo = ALTO_OJO - k * (ALTO_OJO - 6);
    }
  }
}

void dibujarOjos() {
  lienzo.fillScreen(ST77XX_BLACK);
  const int centros[] = {OJO_IZQ_X, OJO_DER_X};

  for (const int centro : centros) {
    if (feliz) {
      const int cx = centro + static_cast<int>(miraX);
      const int cy = LIENZO_H / 2 + 6;
      lienzo.fillCircle(cx, cy, 28, COLOR_OJO);
      lienzo.fillCircle(cx, cy + 16, 28, ST77XX_BLACK);
    } else {
      const int h = static_cast<int>(altoOjo);
      const int x = centro + static_cast<int>(miraX) - ANCHO_OJO / 2;
      const int y = LIENZO_H / 2 + static_cast<int>(miraY) - h / 2;
      lienzo.fillRoundRect(x, y, ANCHO_OJO, h, min(RADIO_OJO, h / 2), COLOR_OJO);
      if (h > 30) lienzo.fillCircle(x + 16, y + 18, 7, ST77XX_WHITE);
    }
  }
  tft.drawRGBBitmap(0, OJOS_Y, lienzo.getBuffer(), ANCHO, LIENZO_H);
}

struct TextoUtf8 {
  const unsigned char* text;
  int read() { return *text ? *text++ : -1; }
};

void dibujarCaracter(int x, int y, uint32_t point, uint16_t color, int scale) {
  const AtenaGlyph glyph = spanishGlyph(point);
  tft.drawChar(x, y + 2 * scale, glyph.character, color, ST77XX_BLACK, scale);
  if (glyph.acute) tft.drawLine(x + 2 * scale, y + scale, x + 4 * scale - 1, y, color);
}

void texto(const char* value, int y, int scale = 2, uint16_t color = ST77XX_WHITE, int maxRows = 1) {
  TextoUtf8 input{reinterpret_cast<const unsigned char*>(value)};
  const int width = (ANCHO - 12) / (6 * scale);
  int row = 0, column = 0;
  for (int byte = input.read(); byte >= 0; byte = input.read()) {
    uint32_t point;
    if (!readUtf8(input, byte, point)) point = '?';
    if (point == '\n' || column == width) {
      if (++row == maxRows) return;
      column = 0;
      if (point == '\n') continue;
    }
    dibujarCaracter(6 + column++ * 6 * scale, y + row * 10 * scale, point, color, scale);
  }
}

void opciones(const char* const* lista, int count) {
  for (int i = 0; i < count; ++i) texto(lista[i], 74 + i * 31, 2, i == seleccion ? ST77XX_CYAN : ST77XX_WHITE);
  texto("< / > elegir   Enter confirmar", PIE_Y, 1, ST77XX_YELLOW);
}

void dibujarPantalla() {
  tft.fillRect(0, CUERPO_Y, ANCHO, ALTO - CUERPO_Y, ST77XX_BLACK);
  char encabezado[40];
  switch (pantalla) {
    case Pantalla::Inicio:
      dibujarOjos();
      texto("Enter: menú", PIE_Y, 1, ST77XX_YELLOW);
      break;
    case Pantalla::Menu: {
      const char* lista[] = {"Flashcards", "Sincronizar", "Volver"};
      texto("Menú", CUERPO_Y);
      opciones(lista, 3);
      break;
    }
    case Pantalla::Pregunta:
    case Pantalla::Respuesta:
      snprintf(encabezado, sizeof(encabezado), "%s %u/%u  pág. %u",
               pantalla == Pantalla::Pregunta ? "Pregunta" : "Respuesta", tarjeta + 1,
               storage.current().count, static_cast<unsigned>(pagina + 1));
      texto(encabezado, CUERPO_Y, 1, ST77XX_CYAN);
      for (unsigned row = 0; row < AtenaStorage::Page::rows; ++row) {
        for (unsigned col = 0; col < AtenaStorage::Page::columns; ++col) {
          const uint32_t point = textoPagina.characters[row][col];
          if (point) dibujarCaracter(6 + col * 12, 49 + row * 20, point, ST77XX_WHITE, 2);
        }
      }
      texto(textoPagina.nextOffset ? "< / > página" : "< atrás", PIE_Y, 1, ST77XX_YELLOW);
      texto(pantalla == Pantalla::Pregunta ? "Enter: respuesta" : "Enter: valorar", PIE_Y + 10, 1, ST77XX_YELLOW);
      break;
    case Pantalla::Valorar: {
      const char* lista[] = {"La recordé", "Repasar", "Volver al mazo"};
      texto("Valorar", CUERPO_Y);
      opciones(lista, 3);
      break;
    }
    case Pantalla::Vincular:
      texto("Vincular Atena", CUERPO_Y);
      texto(sincronizador.pairingCode().c_str(), 84, 3, ST77XX_CYAN);
      texto("Introduce el código en Dispositivo, en la web.", 135, 1, ST77XX_WHITE, 4);
      texto("Enter: cancelar", PIE_Y, 1, ST77XX_YELLOW);
      break;
    case Pantalla::Sincronizar:
      texto("Sincronizando...", CUERPO_Y);
      break;
    case Pantalla::Mensaje:
      texto(mensaje, 58, 2, ST77XX_WHITE, 7);
      texto("Enter: volver", PIE_Y, 1, ST77XX_YELLOW);
      break;
  }
}

void mostrarMensaje(const char* text, Pantalla volver = Pantalla::Menu) {
  mensaje = text;
  regreso = volver;
  pantalla = Pantalla::Mensaje;
  dibujarPantalla();
}

bool cargarPagina() {
  if (!storage.readPage(offsetsPagina[pagina], textoPagina)) {
    mostrarMensaje("No se pudo leer la tarjeta.");
    return false;
  }
  if (textoPagina.nextOffset && offsetsPagina.size() == pagina + 1) offsetsPagina.push_back(textoPagina.nextOffset);
  dibujarPantalla();
  return true;
}

void abrirTexto(bool answer) {
  const uint32_t offset = storage.textOffset(tarjeta, answer);
  if (!offset) {
    mostrarMensaje("Sin mazo. Publica flashcards y sincroniza.");
    return;
  }
  pantalla = answer ? Pantalla::Respuesta : Pantalla::Pregunta;
  pagina = 0;
  offsetsPagina.clear();
  offsetsPagina.push_back(offset);
  cargarPagina();
}

void abrirMenu() {
  pantalla = Pantalla::Menu;
  seleccion = 0;
  dibujarPantalla();
}

void accionBoton(int i, uint32_t ahora) {
  switch (pantalla) {
    case Pantalla::Inicio:
      if (i == 1) abrirMenu();
      else {
        feliz = false;
        destinoX = i == 0 ? -24 : 24;
        destinoY = 0;
        tSiguienteMirada = ahora + 1500;
      }
      break;
    case Pantalla::Menu:
      if (i != 1) {
        seleccion = (seleccion + (i == 0 ? 2 : 1)) % 3;
        dibujarPantalla();
      } else if (seleccion == 0) {
        tarjeta = 0;
        abrirTexto(false);
      } else if (seleccion == 1) {
        pantalla = Pantalla::Sincronizar;
        dibujarPantalla();
        if (const char* resultado = sincronizador.start(horaUtc())) mostrarMensaje(resultado);
        else {
          pantalla = Pantalla::Vincular;
          dibujarPantalla();
        }
      } else {
        pantalla = Pantalla::Inicio;
        feliz = true;
        tFinFeliz = ahora + 2000;
        dibujarPantalla();
      }
      break;
    case Pantalla::Pregunta:
    case Pantalla::Respuesta:
      if (i == 0 && pagina > 0) { --pagina; cargarPagina(); }
      else if (i == 0 && pantalla == Pantalla::Respuesta) abrirTexto(false);
      else if (i == 0) abrirMenu();
      else if (i == 2 && textoPagina.nextOffset) { ++pagina; cargarPagina(); }
      else if (i == 1 && pantalla == Pantalla::Pregunta) abrirTexto(true);
      else if (i == 1) {
        seleccion = 0;
        pantalla = Pantalla::Valorar;
        dibujarPantalla();
      }
      break;
    case Pantalla::Valorar:
      if (i != 1) {
        seleccion = (seleccion + (i == 0 ? 2 : 1)) % 3;
        dibujarPantalla();
      } else if (seleccion == 2) {
        abrirTexto(true);
      } else {
        char fecha[25];
        if (!fechaDeEstudio(fecha)) mostrarMensaje("Ajusta el RTC por USB para guardar la fecha.", Pantalla::Valorar);
        else if (!storage.queueRating(tarjeta, seleccion == 0, fecha)) {
          mostrarMensaje("No se guardó la valoración. Revisa el espacio o sincroniza.", Pantalla::Valorar);
        } else if (tarjeta + 1 == storage.current().count) mostrarMensaje("Mazo completado. Resultados guardados.");
        else { ++tarjeta; abrirTexto(false); }
      }
      break;
    case Pantalla::Vincular:
      if (i == 1) {
        sincronizador.cancel();
        abrirMenu();
      }
      break;
    case Pantalla::Mensaje:
      if (i == 1) {
        if (regreso == Pantalla::Menu) abrirMenu();
        else {
          pantalla = regreso;
          dibujarPantalla();
        }
      }
      break;
    case Pantalla::Sincronizar:
      break;
  }
}

void leerBotones(uint32_t ahora) {
  for (int i = 0; i < 3; ++i) {
    const bool lectura = digitalRead(PIN_BTN[i]);
    if (lectura != lecturaBtn[i]) {
      lecturaBtn[i] = lectura;
      tBtn[i] = ahora;
    } else if (lectura != estadoBtn[i] && ahora - tBtn[i] >= 30) {
      estadoBtn[i] = lectura;
      if (lectura == LOW) accionBoton(i, ahora);
    }
  }
}

void procesarComando(const char* value) {
  if (strncmp(value, "WIFI ", 5) == 0) {
    const bool saved = sincronizador.configureNetwork(value + 5);
    if (saved && pantalla == Pantalla::Vincular) {
      sincronizador.cancel();
      mostrarMensaje("Vuelve a sincronizar para usar la red configurada.");
    }
    Serial.println(saved ? "Wi-Fi guardado." : "Configuración Wi-Fi inválida.");
    return;
  }
  if (strcmp(value, "FS INIT") == 0) {
    Serial.println(sincronizador.initializeStorage() ? "LittleFS inicializado." : "LittleFS ya está montado o requiere revisión.");
    return;
  }
  if (strncmp(value, "TZ ", 3) == 0) {
    int hours, minutes, width = 0;
    const char sign = value[3];
    const bool valid = (sign == '-' || sign == '+') &&
        sscanf(value + 4, "%2d:%2d%n", &hours, &minutes, &width) == 2 &&
        width == 5 && value[4 + width] == '\0' && hours >= 0 && hours <= 14 &&
        minutes >= 0 && minutes < 60 && (hours < 14 || minutes == 0);
    const bool saved = valid && sincronizador.setTimezoneOffset((sign == '-' ? -1 : 1) * (hours * 60 + minutes));
    Serial.println(saved ? "Desfase horario guardado." : "Usa TZ -06:00 o TZ +00:00.");
    return;
  }
  const char* clock = strncmp(value, "RTC ", 4) == 0 ? value + 4 : value;
  int year, month, day, hour, minute, second, width = 0;
  if (sscanf(clock, "%d-%d-%d %d:%d:%d%n", &year, &month, &day, &hour, &minute, &second, &width) == 6 &&
      clock[width] == '\0' && year >= 2024 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31 &&
      hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59) {
    const DateTime date(year, month, day, hour, minute, second);
    if (rtcDisponible && date.isValid()) {
      rtc.adjust(date);
      relojConfiable = true;
      ultimoSegundo = -2;
      Serial.println("RTC ajustado.");
      return;
    }
  }
  Serial.println("Usa WIFI con JSON, RTC AAAA-MM-DD HH:MM:SS, TZ -06:00 o FS INIT.");
}

void leerConsola() {
  static char line[640];
  static size_t length = 0;
  static bool tooLong = false;
  while (Serial.available()) {
    const char byte = Serial.read();
    if (byte == '\r') continue;
    if (byte == '\n') {
      if (tooLong) Serial.println("Comando demasiado largo.");
      else if (length) {
        line[length] = '\0';
        procesarComando(line);
      }
      memset(line, 0, sizeof(line));
      tooLong = false;
      length = 0;
    } else if (length < sizeof(line) - 1) line[length++] = byte;
    else tooLong = true;
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  randomSeed(esp_random());
  for (const int pin : PIN_BTN) pinMode(pin, INPUT_PULLUP);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_BATERIA, ADC_11db);
  if (SENAL_CARGA_VERIFICADA && PIN_ESTADO_CARGA >= 0) pinMode(PIN_ESTADO_CARGA, INPUT_PULLUP);

  SPI.begin(18, -1, 23, -1);
  tft.init(ANCHO, ALTO, SPI_MODE3);
  tft.setRotation(0);
  tft.cp437(true);
  tft.setTextWrap(false);
  tft.fillScreen(ST77XX_BLACK);
  if (!barraBase.getBuffer() || !barraFinal.getBuffer() || !lienzo.getBuffer()) {
    texto("Memoria insuficiente", BARRA_Y, 1, ST77XX_RED);
    while (true) delay(1000);
  }

  rtcDisponible = rtc.begin();
  relojConfiable = rtcDisponible && !rtc.lostPower();
  sincronizador.begin();
  Serial.println("USB: WIFI con JSON, RTC AAAA-MM-DD HH:MM:SS, TZ -06:00.");
  if (!storage.ready()) Serial.println("LittleFS no montado. En una placa nueva usa FS INIT.");
  leerBateria();
  actualizarBarraSuperior();
  dibujarPantalla();
}

void loop() {
  const uint32_t ahora = millis();
  leerConsola();
  leerBotones(ahora);
  if (pantalla == Pantalla::Vincular) {
    if (const char* result = sincronizador.poll(millis())) mostrarMensaje(result);
  }
  if (ahora - tUltimaBateria >= 1000) {
    tUltimaBateria = ahora;
    leerBateria();
  }
  if (ahora - tUltimaLectura >= 250) {
    tUltimaLectura = ahora;
    if (rtcDisponible && relojConfiable && rtc.lostPower()) relojConfiable = false;
    actualizarBarraSuperior();
  }
  if (pantalla == Pantalla::Inicio && ahora - tUltimoFrame >= 33) {
    tUltimoFrame = ahora;
    if (feliz && vencido(ahora, tFinFeliz)) feliz = false;
    actualizarAnimacion(ahora);
    dibujarOjos();
  }
  delay(1);
}
