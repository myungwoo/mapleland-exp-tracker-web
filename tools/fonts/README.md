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

모노 글꼴은 경과 시간·EXP 숫자·OCR 텍스트에만 쓰고, 모노 안의 한글은 Pretendard로 폴백시킵니다.
그래서 **라틴/숫자/기호만** 남겨 1.49MB → 14KB로 줄였습니다.

```bash
curl -sLo D2Coding.woff2 \
  https://cdn.jsdelivr.net/gh/joungkyun/font-d2coding@1.3.2/D2Coding.woff2

.venv/bin/pyftsubset D2Coding.woff2 \
  --output-file=public/fonts/D2Coding.subset.woff2 \
  --flavor=woff2 --layout-features='*' \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2018-201D,U+2026,U+2030,U+2032-2033,U+20A9,U+20BF,U+2190-2193,U+2212,U+25A0-25CF"
```

## @font-face 선언

`lib/fonts.ts`가 `@font-face` CSS를 만들고, `app/layout.tsx`(본문)와 `lib/pip/template.ts`(PiP 창)가 이를 공유합니다.
`unicode-range`를 바꾸면 `lib/fonts.ts`의 D2Coding 선언도 함께 맞춰야 합니다.

## 라이선스

- Pretendard: SIL Open Font License 1.1 (Kil Hyung-jin)
- D2Coding: SIL Open Font License 1.1 (NAVER)

두 폰트 모두 OFL이라 서브셋 재배포가 허용됩니다. (`public/fonts/OFL.txt` 참고)
