"""KS X 1001 완성형 한글 음절(2,350자, iso2022_kr 코덱으로 판별) + 라틴/기호 범위를 pyftsubset용 목록으로 출력합니다."""
import sys

BASE = [
    "U+0020-007E", "U+00A0-00FF", "U+0131", "U+0152-0153", "U+02BB-02BC", "U+02C6", "U+02DA", "U+02DC",
    "U+2000-206F", "U+2070-209F", "U+20A0-20BF", "U+2100-2131", "U+2190-2193", "U+2212",
    "U+25A0-25CF", "U+3000-303F", "U+3131-318E", "U+FF01-FF60",
]

syllables = []
for cp in range(0xAC00, 0xD7A4):
    try:
        chr(cp).encode("iso2022_kr")
    except UnicodeEncodeError:
        continue
    syllables.append("U+%04X" % cp)

sys.stderr.write("KS X 1001 음절 수: %d\n" % len(syllables))
print(",".join(BASE + syllables))
