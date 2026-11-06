"""Extract the supplied 2026 MOIS budget PDF's expenditure detail table.

Usage: python scripts/extract-budget-2026.py --input "path/to/2026년 예산 개요.pdf"
Requires pdfplumber. This deliberately reads the final (확정) column, not 정부안.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys

import pdfplumber


FIRST_PAGE, LAST_PAGE = 15, 25
LEVEL_X = (61.8, 77.6, 93.4, 111.5, 127.4, 146.2)
LEVEL_KEYS = ("account", "field", "sector", "program", "unitProject", "projectName")
AMOUNT_COLUMNS = ((304, 345), (345, 387), (387, 428), (428, 470), (470, 512), (512, 550))
AMOUNT_INDEX = 3
MULTIPLIER = 1_000_000
EXPECTED_TOTAL_MILLION = 76_905_548
EXPECTED_ACCOUNTS_MILLION = {"11": 73_173_076, "39": 3_732_472}
EXPECTED_COUNT = 308


def number(raw: str) -> int:
    if raw == "-":
        return 0
    if not re.fullmatch(r"\d{1,3}(?:,\d{3})*|\d+", raw):
        raise ValueError(f"Unexpected final-budget value: {raw!r}")
    return int(raw.replace(",", ""))


def extract(input_path: Path, render_dir: Path | None = None) -> dict:
    rows = []
    page_counts = Counter()
    with pdfplumber.open(input_path) as document:
        if len(document.pages) != 27:
            raise ValueError("This extractor expects the supplied 27-page edition.")
        summary = document.pages[13].extract_text() or ""
        if "310개 세부사업" not in summary:
            raise ValueError("The expected source-summary heading has changed.")
        for page_number in range(FIRST_PAGE, LAST_PAGE + 1):
            page = document.pages[page_number - 1]
            text = page.extract_text() or ""
            if not all(label in text for label in ("백만원", "정부안", "확정(b)")):
                raise ValueError(f"Budget headers not found on PDF page {page_number}.")
            words = page.extract_words()
            anchors = sorted((w for w in words if re.match(r"^\[\d+\]", w["text"])), key=lambda w: w["top"])
            if not anchors:
                raise ValueError(f"No coded rows on PDF page {page_number}.")
            for index, anchor in enumerate(anchors):
                end = anchors[index + 1]["top"] if index + 1 < len(anchors) else 780
                block = [w for w in words if anchor["top"] - 0.5 <= w["top"] < end - 0.5]
                label = " ".join(w["text"] for w in block if w["x0"] < 304)
                match = re.fullmatch(r"\[(\d+)\](.+)", label)
                if not match:
                    raise ValueError(f"Malformed label on PDF page {page_number}: {label}")
                level = min(range(6), key=lambda candidate: abs(anchor["x0"] - LEVEL_X[candidate]))
                if abs(anchor["x0"] - LEVEL_X[level]) > 1:
                    raise ValueError(f"Unknown hierarchy indentation: {anchor['x0']}")
                values = [" ".join(w["text"] for w in block if left <= w["x0"] < right) for left, right in AMOUNT_COLUMNS]
                if not all(re.fullmatch(r"(?:[△-]?[\d,.]+|-|순증|순감|이관)", value) for value in values):
                    raise ValueError(f"Unexpected comparison columns on PDF page {page_number}: {values}")
                rows.append({"page": page_number, "level": level, "code": match[1], "name": match[2].strip(), "sourceAmount": values[AMOUNT_INDEX], "amount": number(values[AMOUNT_INDEX])})
                if level == 5:
                    page_counts[page_number] += 1

            # Independently read just the final-amount column and compare every coded row.
            final_column = page.crop((428, anchors[0]["top"] - 1, 470, 780)).extract_text() or ""
            column_values = [line.strip() for line in final_column.splitlines() if line.strip()]
            expected_values = [row["sourceAmount"] for row in rows if row["page"] == page_number]
            if column_values != expected_values:
                raise ValueError(f"Independent final-column check failed on PDF page {page_number}.")

            if render_dir:
                render_dir.mkdir(parents=True, exist_ok=True)
                page.to_image(resolution=130).save(render_dir / f"page-{page_number:03}.png")

        total_text = document.pages[14].extract_text() or ""
        if "76,905,548" not in total_text:
            raise ValueError("The expected final grand total is not present.")

    current = [None] * 6
    stack, groups, items = [], [], []
    for row in rows:
        level = row["level"]
        current[level] = row
        for deeper in range(level + 1, 6):
            current[deeper] = None
        while stack and stack[-1]["level"] >= level:
            stack.pop()
        if level < 5:
            group = {**row, "actual": 0, "count": 0}
            groups.append(group)
            stack.append(group)
            continue
        if any(value is None for value in current):
            raise ValueError(f"Missing hierarchy above {row['name']}")
        for group in stack:
            group["actual"] += row["amount"]
            group["count"] += 1
        identity = "|".join(f"{part['code']}:{part['name']}" for part in current)
        digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:10]
        item = {
            "id": f"budget-2026-{current[0]['code']}-{current[4]['code']}-{row['code']}-{digest}",
            "year": 2026,
            **{key: current[index]["name"] for index, key in enumerate(LEVEL_KEYS)},
            **{f"{key}Code": current[index]["code"] for index, key in enumerate(LEVEL_KEYS[:5])},
            "projectCode": row["code"],
            "confirmedAmountWon": row["amount"] * MULTIPLIER,
            "sourceAmount": row["sourceAmount"],
            "sourceUnit": "백만원",
            "sourcePage": row["page"],
            "sourcePrintedPage": row["page"] - 4,
            "active": True,
        }
        items.append(item)

    discrepancies = [group for group in groups if group["actual"] != group["amount"]]
    if discrepancies:
        raise ValueError(f"Hierarchy subtotal discrepancies: {discrepancies}")
    total = sum(item["confirmedAmountWon"] for item in items)
    account_totals = {code: sum(item["confirmedAmountWon"] for item in items if item["accountCode"] == code) for code in EXPECTED_ACCOUNTS_MILLION}
    if total != EXPECTED_TOTAL_MILLION * MULTIPLIER or account_totals != {code: value * MULTIPLIER for code, value in EXPECTED_ACCOUNTS_MILLION.items()}:
        raise ValueError("Grand total or account total does not match the source.")
    if len(items) != EXPECTED_COUNT or len({item["id"] for item in items}) != len(items):
        raise ValueError("Unexpected or duplicate detail-item count.")
    if any(not isinstance(item["confirmedAmountWon"], int) or not 0 <= item["confirmedAmountWon"] <= 9_007_199_254_740_991 for item in items):
        raise ValueError("An amount is not a safe nonnegative integer in won.")

    return {
        "schemaVersion": 1,
        "year": 2026,
        "source": {
            "fileName": input_path.name,
            "title": "2026년도 예산 개요(Ⅲ-2)",
            "publisher": "행정안전부",
            "publishedMonth": "2026-01",
            "sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
            "pageCount": 27,
            "section": "참고 2 2026년도 세출예산 세부내역",
            "scope": "세출예산 세부사업; 세입·요약표·신규/완료사업 중복표 제외",
            "pages": {"from": FIRST_PAGE, "to": LAST_PAGE},
            "printedPages": {"from": 11, "to": 21},
            "unit": "백만원",
            "selectedColumn": "’26년 확정(b)",
            "currency": "KRW",
            "multiplierToWon": MULTIPLIER,
        },
        "validation": {
            "itemCount": len(items),
            "positiveAmountCount": sum(item["confirmedAmountWon"] > 0 for item in items),
            "zeroAmountCount": sum(item["confirmedAmountWon"] == 0 for item in items),
            "totalConfirmedAmountWon": total,
            "sourceTotalConfirmedMillionWon": EXPECTED_TOTAL_MILLION,
            "accountTotalsWon": account_totals,
            "hierarchySubtotalsChecked": len(groups),
            "allHierarchySubtotalsMatch": True,
            "independentFinalColumnCheck": True,
            "itemsPerPdfPage": dict(sorted(page_counts.items())),
            "sourceSummaryDetailCount": 310,
            "sourceSummaryCountDifference": 310 - len(items),
            "notes": [
                "원문의 ‘-’는 2026년 확정액 0원으로 보존했다. 비예산 업무 지정과는 별개의 값이다.",
                "요약표에는 세부사업 310개(일반회계 279, 특별회계 31)로 적혀 있으나 상세표의 독립 세부사업 행은 308개(일반회계 277, 특별회계 31)이다. 차이 2개의 원인은 문서만으로 확정할 수 없어 임의 항목을 만들지 않았다.",
                "308개 행의 합계, 회계별 합계와 161개 상위 계층 소계가 모두 상세표의 2026년 확정액과 일치한다.",
                "PDF 26쪽 신규사업·27쪽 완료사업 표는 중복 설명이므로 별도 항목으로 추가하지 않았다.",
            ],
        },
        "items": items,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("data/budgets/2026-budget.json"))
    parser.add_argument("--render-dir", type=Path)
    args = parser.parse_args()
    result = extract(args.input, args.render_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["validation"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
