# 폰트 서브셋 만들기

`public/fonts/`의 woff2 파일은 아래 절차로 만들었습니다. 폰트를 갱신할 때 같은 절차를 반복하면 됩니다.

## 필요한 도구

```bash
python3 -m venv .venv
.venv/bin/pip install fonttools brotli
```

## Pretendard (본문용, 변수형)

전체 한글(11,172자)을 담으면 1.7MB라 실용적이지 않아서, **KS X 1001 완성형 2,350자 + 라틴/기호**로 줄였습니다.
(Pretendard 공식 `subset` 빌드와 같은 범위입니다. 이 범위 밖의 희귀 음절은 시스템 폰트로 폴백됩니다)

변수형 폰트 하나로 45~930 굵기를 모두 커버하므로, 굵기별 파일을 따로 두지 않습니다.

```bash
curl -sLo PretendardVariable.woff2 \
  https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/woff2/PretendardVariable.woff2

python3 tools/fonts/subset-unicodes.py > unicodes.txt

.venv/bin/pyftsubset PretendardVariable.woff2 \
  --output-file=public/fonts/PretendardVariable.subset.woff2 \
  --flavor=woff2 --layout-features='*' --unicodes-file=unicodes.txt
```

## D2Coding (숫자/모노용)

모노 글꼴은 경과 시간·EXP 숫자·OCR 텍스트에 씁니다. **라틴/숫자/기호 + 한글 5자**만 남겨
1.49MB → 14KB로 줄였습니다.

한글 5자(`누 만 분 억 적`)는 숫자에 붙는 단위입니다. 축 라벨 "1.2만"/"1.2억", 툴팁 "... / 60분"/"... 누적"에
쓰이는데, 모노 스택에 가변폭 글꼴을 폴백으로 끼워 넣는 대신 모노 글꼴 자체에 담았습니다.
D2Coding은 원래 한글을 지원하고 한글 폭이 라틴의 정확히 2배라 고정폭 정렬이 유지됩니다. (5자에 700바이트)

한글 전체를 넣지 않는 이유는 크기입니다: KS X 1001 2,350자 = 300KB, 전체 음절 = 425KB.

**모노 영역에 새 한글을 쓰면** 아래 `--unicodes`와 `lib/fonts.ts`의 `D2CODING_UNICODE_RANGE`에 함께 추가하세요.
빠뜨리면 그 글자만 시스템 글꼴로 떨어집니다.

```bash
curl -sLo D2Coding.woff2 \
  https://cdn.jsdelivr.net/gh/joungkyun/font-d2coding@1.3.2/D2Coding.woff2

# 뒤쪽 5개가 한글입니다: U+B204 누, U+B9CC 만, U+BD84 분, U+C5B5 억, U+C801 적
.venv/bin/pyftsubset D2Coding.woff2 \
  --output-file=public/fonts/D2Coding.subset.woff2 \
  --flavor=woff2 --layout-features='*' \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2018-201D,U+2026,U+2030,U+2032-2033,U+20A9,U+20BF,U+2190-2193,U+2212,U+25A0-25CF,U+B204,U+B9CC,U+BD84,U+C5B5,U+C801"
```

## @font-face 선언

`lib/fonts.ts`가 `@font-face` CSS를 만들고, `app/layout.tsx`(본문)와 `lib/pip/template.ts`(PiP 창)가 이를 공유합니다.
`unicode-range`를 바꾸면 `lib/fonts.ts`의 D2Coding 선언도 함께 맞춰야 합니다.

## 라이선스

- Pretendard: SIL Open Font License 1.1 (Kil Hyung-jin)
- D2Coding: SIL Open Font License 1.1 (NAVER)

두 폰트 모두 OFL이라 서브셋 재배포가 허용됩니다. (`public/fonts/OFL.txt` 참고)
