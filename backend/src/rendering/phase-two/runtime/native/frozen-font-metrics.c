#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_GLYPH_H
#include <hb-ft.h>
#include <hb.h>

#define FONT_PATH "C:\\Users\\Jiayi\\AppData\\Local\\VEP-Studio\\toolchain\\install\\fonts\\NotoSans-wght700-wdth100.ttf"
#define MAX_INPUT_BYTES 512
#define LINE_SPACING_26_6 (12 * 64)

static int ceil_26_6(int64_t value) {
  return value <= 0 ? 0 : (int)((value + 63) / 64);
}

static int valid_utf8(const unsigned char *value, size_t length) {
  size_t index = 0;
  while (index < length) {
    uint32_t codepoint;
    unsigned char first = value[index++];
    if (first <= 0x7f) {
      codepoint = first;
    } else {
      size_t remaining;
      if (first >= 0xc2 && first <= 0xdf) { codepoint = first & 0x1f; remaining = 1; }
      else if (first >= 0xe0 && first <= 0xef) { codepoint = first & 0x0f; remaining = 2; }
      else if (first >= 0xf0 && first <= 0xf4) { codepoint = first & 0x07; remaining = 3; }
      else return 0;
      if (index + remaining > length) return 0;
      for (size_t offset = 0; offset < remaining; offset++) {
        unsigned char next = value[index++];
        if ((next & 0xc0) != 0x80) return 0;
        codepoint = (codepoint << 6) | (next & 0x3f);
      }
      if ((remaining == 2 && codepoint < 0x800) || (remaining == 3 && codepoint < 0x10000) ||
          (codepoint >= 0xd800 && codepoint <= 0xdfff) || codepoint > 0x10ffff) return 0;
    }
    if (codepoint == 0 || codepoint == '\r' || codepoint == '\t' || (codepoint < 0x20 && codepoint != '\n')) return 0;
  }
  return 1;
}

static int shape_line(FT_Face face, const char *text, int length, int *coverage,
                      int64_t *width, int64_t *maximum_y, int64_t *minimum_y) {
  hb_buffer_t *buffer = hb_buffer_create();
  hb_font_t *font = NULL;
  if (!buffer || !hb_buffer_allocation_successful(buffer)) goto fail;
  hb_buffer_set_direction(buffer, HB_DIRECTION_LTR);
  hb_buffer_set_script(buffer, HB_SCRIPT_LATIN);
  hb_buffer_set_language(buffer, hb_language_from_string("en", -1));
  hb_buffer_guess_segment_properties(buffer);
  font = hb_ft_font_create_referenced(face);
  if (!font) goto fail;
  hb_buffer_add_utf8(buffer, text, length, 0, -1);
  hb_shape(font, buffer, NULL, 0);
  unsigned int glyph_count = 0;
  hb_glyph_info_t *info = hb_buffer_get_glyph_infos(buffer, &glyph_count);
  hb_glyph_position_t *positions = hb_buffer_get_glyph_positions(buffer, &glyph_count);
  if (!info || !positions || glyph_count == 0) goto fail;
  int64_t current_width = 0;
  int64_t line_max_y = INT64_MIN;
  int64_t line_min_y = INT64_MAX;
  for (unsigned int index = 0; index < glyph_count; index++) {
    FT_Glyph glyph = NULL;
    FT_BBox box;
    if (info[index].codepoint == 0) *coverage = 0;
    if (FT_Load_Glyph(face, info[index].codepoint, FT_LOAD_DEFAULT) != 0 ||
        FT_Get_Glyph(face->glyph, &glyph) != 0 || !glyph) goto fail;
    FT_Glyph_Get_CBox(glyph, FT_GLYPH_BBOX_SUBPIXELS, &box);
    FT_Done_Glyph(glyph);
    if (box.yMax > line_max_y) line_max_y = box.yMax;
    if (box.yMin < line_min_y) line_min_y = box.yMin;
    current_width += positions[index].x_advance;
  }
  *width = current_width;
  *maximum_y = line_max_y;
  *minimum_y = line_min_y;
  hb_font_destroy(font);
  hb_buffer_destroy(buffer);
  return 1;
fail:
  if (font) hb_font_destroy(font);
  if (buffer) hb_buffer_destroy(buffer);
  return 0;
}

int main(int argc, char **argv) {
  (void)argv;
  if (argc != 1) return 2;
  unsigned char input[MAX_INPUT_BYTES + 1];
  size_t length = fread(input, 1, sizeof(input), stdin);
  if (ferror(stdin) || length == 0 || length > MAX_INPUT_BYTES || !feof(stdin) || !valid_utf8(input, length)) return 2;
  input[length] = 0;

  FT_Library library = NULL;
  FT_Face face = NULL;
  if (FT_Init_FreeType(&library) != 0 || FT_New_Face(library, FONT_PATH, 0, &face) != 0 ||
      FT_Set_Pixel_Sizes(face, 0, 64) != 0) goto fail;

  int coverage = 1;
  int line_count = 0;
  int64_t maximum_width = 0;
  int64_t first_maximum_y = INT64_MIN;
  int64_t last_minimum_y = INT64_MAX;
  size_t start = 0;
  for (size_t index = 0; index <= length; index++) {
    if (index != length && input[index] != '\n') continue;
    if (index == start) goto fail;
    int64_t width = 0, maximum_y = 0, minimum_y = 0;
    if (!shape_line(face, (const char *)&input[start], (int)(index - start), &coverage, &width, &maximum_y, &minimum_y)) goto fail;
    if (line_count == 0) first_maximum_y = maximum_y;
    last_minimum_y = minimum_y;
    if (width > maximum_width) maximum_width = width;
    line_count++;
    if (line_count > 2) goto fail;
    start = index + 1;
  }

  int64_t height = (face->size->metrics.height + LINE_SPACING_26_6) * (line_count - 1) +
                   first_maximum_y - last_minimum_y;
  printf("VEP_FONT_METRIC_V1\t%d\t%d\t%d\t%d\n", coverage, ceil_26_6(maximum_width), ceil_26_6(height), line_count);
  FT_Done_Face(face);
  FT_Done_FreeType(library);
  return 0;
fail:
  if (face) FT_Done_Face(face);
  if (library) FT_Done_FreeType(library);
  return 2;
}
